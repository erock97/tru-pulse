"""Bounded real-PostgreSQL rehearsal. Synthetic data; localhost only.

Usage: python rehearse.py ABS_PSQL ABS_REVIEWED_CHECKOUT
Uses an isolated, newly created database, never the database named postgres.
Base Coach DDL comes from the reviewed checkout. Org/team/agent identity tables
are synthetic scaffolding, not a complete Supabase schema clone.
"""
import concurrent.futures, hashlib, json, pathlib, re, subprocess, sys, time, uuid

psql = pathlib.Path(sys.argv[1]).resolve()
source = pathlib.Path(sys.argv[2]).resolve()
database = 'receipt_rehearsal_' + uuid.uuid4().hex[:12]
passed = []

def sql(query, role=None, db=None):
    query = (f'SET ROLE {role};\n' if role else '') + query
    r = subprocess.run([str(psql), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h',
        '127.0.0.1', '-p', '55439', '-U', 'postgres', '-d', db or database],
        input=query, text=True, encoding='utf-8', capture_output=True, timeout=30)
    if r.returncode: raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()

def q(value): return "'" + str(value).replace("'", "''") + "'"
def j(value): return q(json.dumps(value, separators=(',', ':'))) + '::jsonb'
def check(name, condition):
    assert condition, name
    passed.append(name)
    print('PASS:', name, flush=True)
def rejected(name, query, marker, role='service_role'):
    try: sql(query, role)
    except RuntimeError as e:
        check(name, marker in str(e)); return
    raise AssertionError(name + ': unexpectedly accepted')

sql('CREATE DATABASE ' + database, db='postgres')
sql("""DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
 END $$;
 CREATE TABLE orgs(id uuid PRIMARY KEY);
 CREATE TABLE teams(id uuid PRIMARY KEY, org_id uuid REFERENCES orgs, is_active boolean DEFAULT true);
 CREATE TABLE agents(id uuid PRIMARY KEY, team_id uuid REFERENCES teams);
""")
for file in ['hq_coach_weekly_report.sql', 'hq_coach_patterns.sql']:
    text = (source/'db'/file).read_text(encoding='utf-8')
    for ddl in re.findall(r'create table if not exists .*?\n\);', text, re.S|re.I):
        sql(ddl)
# These extra columns were confirmed by metadata-only production inspection.
sql('ALTER TABLE coach_patterns ADD COLUMN last_briefed_at timestamptz, ADD COLUMN briefed_occurrences integer NOT NULL DEFAULT 0;')
# Existing production grants were inspected separately. RLS below models a
# broker org claim for visibility testing; it does not reproduce Supabase Auth.
sql("""GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
 GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
 GRANT ALL ON teams,agents,coach_weekly_reports TO anon,authenticated;
 ALTER TABLE coach_weekly_reports ENABLE ROW LEVEL SECURITY;
 CREATE POLICY broker_read ON coach_weekly_reports FOR SELECT TO authenticated
 USING(status='published' AND org_id::text=current_setting('test.org',true));
""")
migration = source/'supabase/migrations/20260908181709_report_receipt_controls.sql'
sql(migration.read_text(encoding='utf-8'))
team, other, org, otherorg = [str(uuid.uuid4()) for _ in range(4)]
sql(f'INSERT INTO orgs VALUES({q(org)}),({q(otherorg)}); INSERT INTO teams VALUES({q(team)},{q(org)},true),({q(other)},{q(otherorg)},true);')

def payload(run, quote='Synthetic evidence', coverage=True, target=team):
    p = {'run':{'teamId':target,'runId':run,'trigger':'weekly','startDate':'2026-09-01','endDate':'2026-09-07','generatedAt':'2026-09-08T12:00:00Z'},
         'agents':[{'agentName':'Synthetic Agent','opportunityPoints':[{'patternKey':'synthetic-rehearsal','findingIds':['synthetic-finding'],'explanation':'Synthetic fixture','coachingMove':'Synthetic fixture'}]}],
         'findings':[{'findingId':'synthetic-finding','agentName':'Synthetic Agent','quote':quote,'leadName':'Synthetic Lead','channel':'text','occurredAt':'2026-09-07T12:00:00Z'}]}
    if coverage is not None: p['coverage']={'rosterComplete':coverage,'contacts':[{'status':'reviewed' if coverage else 'unresolved'}]}
    return p
def accept(p):
    canonical=json.dumps(p,sort_keys=True,separators=(',',':'))
    return f'SELECT coach_receipt_accept({q(p["run"]["teamId"])},{q(p["run"]["runId"])},{q(canonical)},{j(p)},\'{{}}\'::jsonb,\'synthetic-producer\');'
def receipt(run): return json.loads(sql(f'SELECT coach_receipt_lookup({q(team)},{q(run)});','service_role'))
def command(run, action='release', revision=None, op=None):
    r=receipt(run)
    return {'operationId':op or uuid.uuid4().hex,'action':action,'teamId':team,'runId':run,'expectedHash':r['payloadHash'],'expectedRevision':revision or r['revision'],'reason':'Synthetic rehearsal approval'}
def control(c): return f'SELECT coach_receipt_control({q(team)},\'synthetic-operator\',{j(c)},{q(json.dumps(c,sort_keys=True,separators=(",",":")))},false);'

check('migration applied on PostgreSQL', 'PostgreSQL 17.' in sql('SELECT version();'))
check('anon cannot execute receipt lookup', sql("SELECT has_function_privilege('anon','coach_receipt_lookup(uuid,text)','EXECUTE');")=='f')
check('authenticated cannot execute controls', sql("SELECT has_function_privilege('authenticated','coach_receipt_control(uuid,text,jsonb,text,boolean)','EXECUTE');")=='f')
rejected('actual anon lookup denied', f'SELECT coach_receipt_lookup({q(team)},\'missing\');','permission denied','anon')
check('service role can execute controls',sql("SELECT has_function_privilege('service_role','coach_receipt_control(uuid,text,jsonb,text,boolean)','EXECUTE');")=='t')
check('audit update/delete forbidden',sql("SELECT has_table_privilege('service_role','coach_report_audit','UPDATE') OR has_table_privilege('service_role','coach_report_audit','DELETE');")=='f')

# Hold the team lock until both independent sessions are visibly waiting.
p=payload('concurrent')
locker=subprocess.Popen([str(psql),'-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55439','-U','postgres','-d',database],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
locker.stdin.write(f"BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('coach-team:{team}',0)); SELECT 'LOCK_HELD';\n");locker.stdin.flush()
while locker.stdout.readline().strip()!='LOCK_HELD':
    if locker.poll() is not None: raise AssertionError('Lock setup failed')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    futures=[pool.submit(lambda:json.loads(sql(accept(p),'service_role'))) for _ in range(2)]
    try:
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            waiting=sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%coach_receipt_accept%';")
            if waiting=='2': break
            time.sleep(.02)
        check('two real acceptance sessions wait concurrently on team lock',waiting=='2')
    finally:
        locker.stdin.write('COMMIT;\n');locker.stdin.flush();locker.stdin.close();locker.wait(timeout=10)
    results=[f.result() for f in futures]
check('concurrent identical accept has one insertion and one replay',sorted(r['replayed'] for r in results)==[False,True])
check('one accepted audit and one report',sql('SELECT (SELECT count(*) FROM coach_report_audit)=1 AND (SELECT count(*) FROM coach_weekly_reports)=1;')=='t')
check('initial state held revision 1',receipt('concurrent')['publicationStatus']=='held' and receipt('concurrent')['revision']==1)
check('held invisible to broker',sql(f"SET test.org={q(org)}; SELECT count(*) FROM coach_weekly_reports;",'authenticated')=='0')
rejected('changed payload conflicts',accept(payload('concurrent','different')),'payload_conflict')
rejected('cross-team identity conflicts',accept(payload('concurrent',target=other)),'identity_conflict')

release=command('concurrent')
sql(control(release),'service_role')
check('release publishes with derived complete',receipt('concurrent')['publicationStatus']=='published' and receipt('concurrent')['derivedProcessing']['status']=='complete')
check('published visible only to correct broker',sql(f"SET test.org={q(org)}; SELECT count(*) FROM coach_weekly_reports;",'authenticated')=='1' and sql(f"SET test.org={q(otherorg)}; SELECT count(*) FROM coach_weekly_reports;",'authenticated')=='0')
check('release rebuilds finding provenance',sql('SELECT count(*) FROM coach_report_evidence_sources;')=='1')
check('identical control replay',json.loads(sql(control(release),'service_role'))['replayed'])

# A published legacy report shares the same durable evidence.
legacy=payload('legacy-history')
sql(f"INSERT INTO coach_weekly_reports(run_id,team_id,org_id,team_slug,status,week_start,week_end,payload,generated_at) VALUES('legacy-history',{q(team)},{q(org)},'synthetic','published','2026-09-01','2026-09-07',{j(legacy)},'2026-09-08T11:00:00Z');")
sql(control(command('concurrent','withdraw')),'service_role')
check('withdraw hides controlled report',receipt('concurrent')['publicationStatus']=='withdrawn')
check('withdraw retains evidence from published legacy report',sql('SELECT count(*) FROM coach_pattern_findings;')=='1' and sql('SELECT count(*) FROM coach_report_evidence_sources;')=='1')
check('retry cannot revive withdrawn report',json.loads(sql(accept(p),'service_role'))['receipt']['publicationStatus']=='withdrawn')
rejected('legacy identity cannot be adopted',accept(legacy),'legacy_conflict')

sql(accept(payload('conflicting-evidence','conflicting quote')),'service_role')
before=sql('SELECT count(*) FROM coach_report_audit;')
rejected('evidence conflict aborts release',control(command('conflicting-evidence')),'evidence_conflict')
check('failed release leaves held revision and audit unchanged',receipt('conflicting-evidence')['revision']==1 and receipt('conflicting-evidence')['publicationStatus']=='held' and sql('SELECT count(*) FROM coach_report_audit;')==before)
check('failed release restores existing derived evidence',sql("SELECT quote FROM coach_pattern_findings;")=='Synthetic evidence')

sql(accept(payload('partial',coverage=False)),'service_role')
rejected('partial release remains disabled',control(command('partial')),'partial_release_disabled')
sql(accept(payload('unknown',coverage=None)),'service_role')
check('absent coverage remains unknown',receipt('unknown')['coverageState']=='unknown')
rejected('immutable payload guard',"UPDATE coach_weekly_reports SET payload='{}' WHERE run_id='unknown';",'immutable_receipt')
rejected('direct publication blocked',"UPDATE coach_weekly_reports SET status='published' WHERE run_id='unknown';",'explicit_control_required')
check('post-migration anon receipt tables inaccessible',sql("SELECT has_table_privilege('anon','coach_report_receipts','SELECT');")=='f')

# Exercise failed withdrawal after a successful release with legacy history.
sql(accept(payload('withdraw-rollback')),'service_role')
sql(control(command('withdraw-rollback')),'service_role')
badlegacy=payload('legacy-conflict','conflicting legacy quote')
sql(f"INSERT INTO coach_weekly_reports(run_id,team_id,org_id,team_slug,status,week_start,week_end,payload,generated_at) VALUES('legacy-conflict',{q(team)},{q(org)},'synthetic','published','2026-09-01','2026-09-07',{j(badlegacy)},'2026-09-08T11:01:00Z');")
before=sql('SELECT count(*) FROM coach_report_audit;')
rejected('failed withdrawal aborts on conflicting remaining legacy evidence',control(command('withdraw-rollback','withdraw')),'evidence_conflict')
check('failed withdrawal retains published state and revision',receipt('withdraw-rollback')['publicationStatus']=='published' and receipt('withdraw-rollback')['revision']==2)
check('failed withdrawal leaves audit and projection unchanged',sql('SELECT count(*) FROM coach_report_audit;')==before and sql('SELECT count(*) FROM coach_report_evidence_sources;')=='2')

result={'database':database,'host':'127.0.0.1:55439','postgres':sql('SELECT version();'),'migrationSha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'passed':len(passed),'failed':0,'checks':passed,'limitations':['Synthetic org/team/agent scaffolding and representative report history; not a full production clone.','PostgreSQL 17.11 Windows; production inspected version 17.6 Linux.','HTTP authentication and broker browser refresh belong to H05-H07.']}
pathlib.Path(__file__).with_name('rehearsal-results.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'passed':len(passed),'failed':0,'database':database}))
