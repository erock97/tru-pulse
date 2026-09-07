import { createContext,useContext,useState,type ReactNode } from 'react';
export type Assignment={agentId:string;leadId:string;leadName?:string;at:string;line:number};
export type Practice={agentId:string;name:string;focus:string;due:string;outcome:string};
type State={assignments:Assignment[];assignmentFile:string;setAssignments:(rows:Assignment[],file:string)=>void;practice:Practice|null;setPractice:(p:Practice|null)=>void};
const Context=createContext<State|null>(null);
export function OperationsProvider({children}:{children:ReactNode}){const [assignments,setRows]=useState<Assignment[]>([]),[assignmentFile,setFile]=useState(''),[practice,setPractice]=useState<Practice|null>(null);return <Context.Provider value={{assignments,assignmentFile,setAssignments:(r,f)=>{setRows(r);setFile(f);},practice,setPractice}}>{children}</Context.Provider>;}
export function useOperations(){return useContext(Context);}
