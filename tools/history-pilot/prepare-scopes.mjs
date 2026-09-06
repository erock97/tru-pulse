import fs from 'node:fs';import path from 'node:path';import {applyScope} from './scope.mjs';
const [root,...tags]=process.argv.slice(2);if(!root||!tags.length)throw Error('Pass private inventory root and team tags');
const config=JSON.parse(fs.readFileSync(new URL('./scopes.json',import.meta.url),'utf8'));
for(const tag of tags){
 const spec=config.teams[tag];if(!spec)throw Error('Unknown team');
 const inventory=JSON.parse(fs.readFileSync(path.join(root,tag+'-inventory.json'),'utf8'));
 if(inventory.tag!==tag)throw Error('Inventory team mismatch');
 const data={...applyScope(inventory,spec.sources,config),team:spec.team,sourceConfirmationPending:!!spec.sourceConfirmationPending,dateConfirmationPending:!!spec.dateConfirmationPending};
 const destination=path.join(root,tag);fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,'inventory.json'),JSON.stringify(data));
 console.log(JSON.stringify({tag,leads:data.people.length,excludedInactive:data.excludedInactive}));
}
