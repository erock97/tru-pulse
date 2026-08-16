(function () {
  "use strict";
  var SUPABASE = "https://yeyoteredgunhvhqmais.supabase.co";
  var KEY = "sb_publishable_y6H7cAEoc-OElwqt-ewLag_g29d4evk";
  var view = document.getElementById("view");
  var title = document.getElementById("title");
  var sub = document.getElementById("sub");
  var zone = (Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";
  var state = { type: null, slots: [], chosen: null };

  function api(path, options) {
    options = options || {};
    var headers = { apikey: KEY, Authorization: "Bearer " + KEY,
                    "Content-Type": "application/json" };
    if (options.headers) for (var k in options.headers) headers[k] = options.headers[k];
    return fetch(SUPABASE + path, {
      method: options.method || "GET", headers: headers, body: options.body
    });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function busy(message) {
    view.innerHTML = '<div class="card"><span class="spin"></span>' + esc(message) + "</div>";
  }
  function problem(message) {
    view.innerHTML = '<div class="card"><p class="err" style="margin:0">' +
      esc(message) + "</p></div>";
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var DAY = { weekday: "long", month: "long", day: "numeric" };
  var TIME = { hour: "numeric", minute: "2-digit" };
  function dayLabel(iso) { return new Date(iso).toLocaleDateString(undefined, DAY); }
  function timeLabel(iso) { return new Date(iso).toLocaleTimeString(undefined, TIME); }

  /* ---------------- choosing a meeting type ---------------- */

  /* Whose booking page this is.
   *
   * meeting_types is per-user and this project has more than one user. Without
   * this filter the page listed EVERY published type from EVERY account: on
   * 2026-08-09 it was advertising two types that sat on a client's login, one of
   * them named "1:1 With Eric". Booking it would have resolved to that client's
   * availability and written the event to their calendar, because the settlement
   * engine loads the type's owner.
   *
   * Not a secret — it is a row id in a table anon may already read. It is here so
   * a second tenant can never bleed onto this page again. A per-owner path is the
   * eventual fix; this is the guard until then. */
  var OWNER = "d6b9504c-f35e-49c9-af99-6a2de2069db8";

  /* published=true means "this type is active for its owner", not "show this
   * on the public book page". Eric's 1:1s, intro, leadership sync, and strategy
   * session are published so they work for him; they are not for strangers.
   * db/meeting_types_public_read.sql adds the real gate (is_public + tighter
   * anon RLS). Until that is applied, PostgREST still returns every published
   * row to anyone with the publishable key. This allowlist stays as defense
   * in depth after that lands. Do not query a column that is not live yet,
   * and do not fall back to the full published list. */
  var PUBLIC_SLUGS = ["client-consultation-call"];

  function isPublicSlug(slug) {
    return PUBLIC_SLUGS.indexOf(slug) !== -1;
  }

  function publicSlugQuery() {
    return "slug=in.(" + PUBLIC_SLUGS.join(",") + ")";
  }

  function showTypes() {
    busy("Loading…");
    api("/rest/v1/meeting_types?select=slug,name,description,duration_minutes" +
        "&user_id=eq." + OWNER +
        "&published=eq.true&" + publicSlugQuery() +
        "&order=sort_order.asc")
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (types) {
        types = (types || []).filter(function (t) { return isPublicSlug(t.slug); });
        if (!types.length) {
          problem("There are no meeting types available to book right now.");
          return;
        }
        if (types.length === 1) { pickType(types[0]); return; }
        view.innerHTML = types.map(function (t) {
          var mins = t.duration_minutes;
          var len = mins % 60 === 0 && mins >= 60
            ? (mins / 60) + (mins === 60 ? " hour" : " hours") : mins + " minutes";
          return '<button class="type" data-slug="' + esc(t.slug) + '">' +
            '<span class="len">' + esc(len) + "</span>" +
            "<h2>" + esc(t.name) + "</h2>" +
            (t.description ? "<p>" + esc(t.description) + "</p>" : "") +
            "</button>";
        }).join("");
        Array.prototype.forEach.call(view.querySelectorAll(".type"), function (node) {
          node.addEventListener("click", function () {
            pickType(types.filter(function (t) { return t.slug === node.dataset.slug; })[0]);
          });
        });
      })
      .catch(function () { problem("Could not load the booking options. Please try again."); });
  }

  function pickType(type) {
    state.type = type;
    title.textContent = type.name;
    sub.textContent = "Times are shown in your own timezone.";
    loadSlots();
  }

  /* ---------------- asking for times ---------------- */

  function loadSlots() {
    busy("Finding open times…");
    fetch(SUPABASE + "/functions/v1/jarvis-slot-ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_type_slug: state.type.slug, days: 21,
                             visitor_timezone: zone })
    })
      .then(function (r) {
        if (r.status === 429) throw new Error("Too many requests just now. Give it a minute.");
        if (!r.ok) throw new Error("Could not look up open times.");
        return r.json();
      })
      .then(function (asked) { return pollSlots(asked.token, 0); })
      .catch(function (e) { problem(e.message || "Could not look up open times."); });
  }

  // The answer comes from a laptop, not from this database, so it takes a
  // moment. Polling rather than waiting on one long request keeps the page
  // responsive and lets it say something honest if the answer never arrives.
  function pollSlots(token, attempt) {
    if (attempt > 40) {
      problem("Couldn't reach the calendar just now. Please try again shortly.");
      return;
    }
    return api("/rest/v1/slot_requests?select=answer_status,slots",
               { headers: { "x-slot-token": token } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var row = rows[0];
        if (!row || !row.answer_status) {
          return sleep(500).then(function () { return pollSlots(token, attempt + 1); });
        }
        if (row.answer_status !== "ok" || !row.slots || !row.slots.length) {
          problem("There are no open times at the moment. Please check back later.");
          return;
        }
        state.slots = row.slots;
        renderSlots();
      });
  }

  function renderSlots() {
    var byDay = [];
    state.slots.forEach(function (slot) {
      var label = dayLabel(slot.start);
      var group = byDay.filter(function (g) { return g.label === label; })[0];
      if (!group) { group = { label: label, slots: [] }; byDay.push(group); }
      group.slots.push(slot);
    });
    view.innerHTML =
      '<button class="ghost" id="back">← All meeting types</button>' +
      byDay.map(function (g) {
        return '<div class="day">' + esc(g.label) + "</div><div class=\"slots\">" +
          g.slots.map(function (s) {
            return '<button class="slot" data-start="' + esc(s.start) +
              '" data-end="' + esc(s.end) + '">' + esc(timeLabel(s.start)) + "</button>";
          }).join("") + "</div>";
      }).join("");
    var back = document.getElementById("back");
    if (back) back.addEventListener("click", function () {
      title.textContent = "Book a time";
      sub.textContent = "Pick whichever suits you.";
      showTypes();
    });
    Array.prototype.forEach.call(view.querySelectorAll(".slot"), function (node) {
      node.addEventListener("click", function () {
        showForm({ start: node.dataset.start, end: node.dataset.end });
      });
    });
  }

  /* ---------------- details and booking ---------------- */

  function showForm(slot) {
    state.chosen = slot;
    view.innerHTML =
      '<button class="ghost" id="back">← Pick a different time</button>' +
      '<div class="card">' +
        '<p class="big">' + esc(dayLabel(slot.start)) + "</p>" +
        '<p style="margin:0;color:var(--muted)">' + esc(timeLabel(slot.start)) +
          " – " + esc(timeLabel(slot.end)) + " · " + esc(zone) + "</p>" +
        '<label for="n">Your name</label><input id="n" autocomplete="name" maxlength="120">' +
        '<label for="e">Email</label><input id="e" type="email" autocomplete="email" maxlength="320">' +
        '<label for="m">Anything useful to know? <span style="opacity:.7">(optional)</span></label>' +
        '<textarea id="m" maxlength="2000"></textarea>' +
        '<button class="primary" id="go">Confirm booking</button>' +
        '<p class="note" id="msg"></p>' +
      "</div>";
    document.getElementById("back").addEventListener("click", renderSlots);
    document.getElementById("go").addEventListener("click", submit);
  }

  function submit() {
    var name = document.getElementById("n").value.trim();
    var email = document.getElementById("e").value.trim();
    var note = document.getElementById("m").value.trim();
    var msg = document.getElementById("msg");
    var go = document.getElementById("go");
    if (!name) { msg.className = "note err"; msg.textContent = "Please add your name."; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      msg.className = "note err"; msg.textContent = "Please add a valid email address."; return;
    }
    go.disabled = true;
    msg.className = "note"; msg.innerHTML = '<span class="spin"></span>Holding that time…';

    fetch(SUPABASE + "/functions/v1/jarvis-book", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meeting_type_slug: state.type.slug,
        starts_at: state.chosen.start, ends_at: state.chosen.end,
        name: name, email: email, note: note || null, visitor_timezone: zone
      })
    })
      .then(function (r) {
        return r.json().then(function (body) { return { status: r.status, body: body }; });
      })
      .then(function (out) {
        if (out.status === 409) {
          msg.className = "note err";
          msg.textContent = "Sorry — that time was just taken. Please pick another.";
          go.disabled = false;
          setTimeout(loadSlots, 1400);
          return;
        }
        if (out.status !== 202) {
          msg.className = "note err";
          msg.textContent = out.body.error || "Could not book that time.";
          go.disabled = false;
          return;
        }
        return pollBooking(out.body.token, name, 0);
      })
      .catch(function () {
        msg.className = "note err";
        msg.textContent = "Something went wrong. Please try again.";
        go.disabled = false;
      });
  }

  // The booking is held the moment the function returns, but it is not
  // confirmed until the calendar has actually accepted it. The page waits
  // rather than claiming success early.
  function pollBooking(token, name, attempt) {
    if (attempt > 40) {
      view.innerHTML = '<div class="card"><p class="big">Still working on it</p>' +
        '<p style="margin:0;color:var(--muted)">Your time is held. If you don\'t hear ' +
        "back shortly, please get in touch.</p></div>";
      return;
    }
    // Through the endpoint, not the table: the token is stored hashed, so a
    // direct row lookup by raw token can never match.
    return fetch(SUPABASE + "/functions/v1/jarvis-booking-status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (row) {
        if (!row || row.status === "pending") {
          return sleep(600).then(function () { return pollBooking(token, name, attempt + 1); });
        }
        if (row.status === "confirmed") { confirmed(token, name); return; }
        // Only a genuinely taken slot says "taken". Everything else is
        // honest about being unable to confirm rather than blaming the time.
        var why = row.cancelled_reason === "slot_taken"
          ? "That time was taken while we were confirming it."
          : row.cancelled_reason === "type_unavailable"
          ? "That kind of meeting is no longer being booked."
          : "We couldn't confirm that time.";
        view.innerHTML = '<div class="card"><p class="big">Not confirmed</p>' +
          '<p style="margin:0 0 14px;color:var(--muted)">' + esc(why) + "</p>" +
          '<button class="primary" id="again">Pick another time</button></div>';
        document.getElementById("again").addEventListener("click", loadSlots);
      });
  }

  function confirmed(token, name) {
    var link = location.origin + location.pathname + "?cancel=" + encodeURIComponent(token);
    title.textContent = "You're booked";
    sub.textContent = "";
    view.innerHTML = '<div class="card">' +
      '<p class="big ok">' + esc(dayLabel(state.chosen.start)) + "</p>" +
      '<p style="margin:0 0 14px">' + esc(timeLabel(state.chosen.start)) + " – " +
        esc(timeLabel(state.chosen.end)) + " · " + esc(zone) + "</p>" +
      "<p style=\"margin:0 0 6px;color:var(--muted)\">It's on the calendar, " +
        esc(name.split(" ")[0]) + ". Keep this link if you need to cancel:</p>" +
      '<input readonly id="cancel-link" value="' + esc(link) + '">' +
      "</div>";
    var cancelLink = document.getElementById("cancel-link");
    if (cancelLink) cancelLink.addEventListener("click", function () { cancelLink.select(); });
  }

  /* ---------------- cancelling ---------------- */

  function showCancel(token) {
    title.textContent = "Your meeting";
    sub.textContent = "";
    // Both options together. Offering only "cancel" pushes someone who simply
    // needs a different time into giving up the meeting entirely.
    view.innerHTML = '<div class="card" id="manage">' +
      '<p style="margin:0 0 16px">Need a different time, or want to cancel?</p>' +
      '<button class="primary" id="move">Pick a different time</button>' +
      '<button class="ghost" id="drop" style="width:100%;margin-top:10px;margin-bottom:0">' +
        "Cancel the meeting</button>" +
      '<p class="note" id="msg"></p></div>';

    document.getElementById("move").addEventListener("click", function () {
      startReschedule(token);
    });
    document.getElementById("drop").addEventListener("click", function () {
      var drop = document.getElementById("drop");
      var msg = document.getElementById("msg");
      drop.disabled = true;
      msg.innerHTML = '<span class="spin"></span>Cancelling…';
      fetch(SUPABASE + "/functions/v1/jarvis-cancel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token })
      })
        .then(function (r) {
          return r.json().then(function (b) { return { status: r.status, body: b }; });
        })
        .then(function (out) {
          if (out.status === 200) {
            view.innerHTML = '<div class="card"><p class="big ok">Cancelled</p>' +
              '<p style="margin:0;color:var(--muted)">' + esc(out.body.message) + "</p></div>";
            return;
          }
          msg.className = "note err";
          msg.textContent = out.body.error || "Could not cancel that booking.";
          drop.disabled = false;
        })
        .catch(function () {
          msg.className = "note err";
          msg.textContent = "Something went wrong. Please try again.";
          drop.disabled = false;
        });
    });
  }

  // Rescheduling reuses the ordinary slot list, so an invitee sees exactly the
  // times a new visitor would — the same rules, the same live calendar.
  function startReschedule(token) {
    busy("Finding open times…");
    fetch(SUPABASE + "/functions/v1/jarvis-booking-status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (row) {
        if (!row || !row.meeting_type_id) throw new Error("That link is no longer active.");
        return api("/rest/v1/meeting_types?select=slug,name,duration_minutes" +
                   "&id=eq." + encodeURIComponent(row.meeting_type_id) + "&limit=1");
      })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        if (!rows.length) throw new Error("That meeting type is no longer available.");
        state.type = rows[0];
        return fetch(SUPABASE + "/functions/v1/jarvis-slot-ask", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meeting_type_slug: state.type.slug, days: 21,
                                 visitor_timezone: zone })
        });
      })
      .then(function (r) {
        if (!r.ok) throw new Error("Could not look up open times.");
        return r.json();
      })
      .then(function (asked) { return pollSlots(asked.token, 0); })
      .then(function () {
        if (!state.slots.length) return;
        renderRescheduleSlots(token);
      })
      .catch(function (e) { problem(e.message || "Could not look up open times."); });
  }

  function renderRescheduleSlots(token) {
    renderSlots();
    var back = document.getElementById("back");
    if (back) {
      back.textContent = "← Keep my current time";
      back.addEventListener("click", function () { showCancel(token); });
    }
    Array.prototype.forEach.call(view.querySelectorAll(".slot"), function (node) {
      var fresh = node.cloneNode(true);
      node.parentNode.replaceChild(fresh, node);
      fresh.addEventListener("click", function () {
        moveTo(token, fresh.dataset.start, fresh.dataset.end);
      });
    });
  }

  function moveTo(token, start, end) {
    busy("Holding the new time…");
    fetch(SUPABASE + "/functions/v1/jarvis-reschedule", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token, starts_at: start, ends_at: end })
    })
      .then(function (r) {
        return r.json().then(function (b) { return { status: r.status, body: b }; });
      })
      .then(function (out) {
        if (out.status === 409) {
          // The old booking survives, and saying so is the point: they took an
          // action to keep the meeting, not to lose it.
          view.innerHTML = '<div class="card"><p class="big">That time went</p>' +
            '<p style="margin:0 0 14px;color:var(--muted)">' +
            esc(out.body.error) + "</p>" +
            '<button class="primary" id="again">Pick another time</button></div>';
          document.getElementById("again").addEventListener("click", function () {
            startReschedule(token);
          });
          return;
        }
        if (out.status !== 202 && out.status !== 207) {
          problem(out.body.error || "Could not move that meeting.");
          return;
        }
        state.chosen = { start: start, end: end };
        return pollBooking(out.body.token, "there", 0);
      })
      .catch(function () { problem("Something went wrong. Please try again."); });
  }

  /* ---------------- entry ---------------- */

  var params = new URLSearchParams(location.search);
  var cancelToken = params.get("cancel");
  if (cancelToken) {
    showCancel(cancelToken);
  } else {
    // Deep links use /book/?t=<slug> rather than /book/<slug>. The Pages
    // project serves the TruHQ app shell for any unknown path, ahead of a
    // _redirects rule, so a path segment reached Eric's logged-in app instead
    // of a list of times. A query parameter needs no routing to work at all.
    var path = params.get("t") || "";
    // Unknown or internal slugs must not list every published type. showTypes
    // itself is allowlisted; skip the lookup entirely when t is not public.
    if (/^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/.test(path) && isPublicSlug(path)) {
      api("/rest/v1/meeting_types?select=slug,name,description,duration_minutes" +
          "&user_id=eq." + OWNER +
          "&published=eq.true&slug=eq." + encodeURIComponent(path) + "&limit=1")
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
          var row = rows[0];
          if (row && isPublicSlug(row.slug)) pickType(row);
          else showTypes();
        })
        .catch(function () { showTypes(); });
    } else {
      showTypes();
    }
  }
})();
