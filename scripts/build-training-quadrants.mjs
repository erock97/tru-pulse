import fs from 'node:fs';
import { reviseTraining } from './training-quadrants.mjs';
for(let day=1;day<=4;day++){
 const file=new URL(`../web/public/workshops/day${day}.json`,import.meta.url);
 const data=reviseTraining(JSON.parse(fs.readFileSync(file,'utf8')));
 fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
 console.log(`Day ${day}: ${data.slides.length} slides, ${data.duration} minutes; four quadrants`);
}
