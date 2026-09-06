const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname),out=path.join(root,'landing-dist');
fs.mkdirSync(out,{recursive:true});fs.cpSync(path.join(root,'web/dist'),out,{recursive:true});
const shell=fs.readFileSync(path.join(out,'index.html'),'utf8');
for(const route of ['services','work','about','apply','privacy','terms','refund-policy','sms-terms']){fs.mkdirSync(path.join(out,route),{recursive:true});fs.writeFileSync(path.join(out,route,'index.html'),shell)}
fs.writeFileSync(path.join(out,'404.html'),shell);
fs.cpSync(path.join(root,'landing-approved'),out,{recursive:true});
let html=fs.readFileSync(path.join(out,'index.html'),'utf8').replace('<script src="../media-loader.js"></script>','').replace('../poster.jpg','poster.jpg');
html=html.replace('</head>','<link rel="canonical" href="https://truhq.co/"><link rel="icon" href="/favicon.ico"></head>');fs.writeFileSync(path.join(out,'index.html'),html);
const js=path.join(out,'cinema.js');fs.writeFileSync(js,fs.readFileSync(js,'utf8').replace('../film-240.json','film-240.json').replace('../film.json','film.json'));
const redirects=path.join(out,'_redirects');fs.writeFileSync(redirects,fs.readFileSync(redirects,'utf8').split('\n').filter(l=>!l.includes('/index.html')).join('\n'));
const headers=path.join(out,'_headers');let h=fs.readFileSync(headers,'utf8');h=h.replace("media-src 'self' blob:","media-src 'self' https://d2ol7oe51mr4n9.cloudfront.net blob:").replace("font-src 'self' data:;","font-src 'self' data: https://fonts.gstatic.com;").replace("style-src 'self' 'unsafe-inline';","style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;");h+='\n/cinema.js\n  Cache-Control: no-cache\n/cinema.css\n  Cache-Control: no-cache\n';fs.writeFileSync(headers,h);
console.log('Landing staged with existing booking and policy routes.');
