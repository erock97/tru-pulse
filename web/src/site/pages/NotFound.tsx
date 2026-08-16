export default function NotFound() {
  return (
    <div className="interior">
      <header className="panel band" id="top"><div className="wrap">
        <div className="kick reveal">404</div>
        <h1 className="h2 reveal d1" style={{ marginTop: '1rem' }}>Page not found.</h1>
        <p className="sub reveal d2">This page does not exist.</p>
        <p className="reveal d3">
          <a className="nf-home" href="/">Back to home</a>
        </p>
      </div></header>
    </div>
  );
}
