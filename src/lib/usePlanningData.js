import { useEffect, useState } from 'react';
import { loadPlanningRange } from './teamPlanning.js';
export function usePlanningData(db,from,to,revision) {
  const [state,setState]=useState({data:{orders:[],rosters:[],absences:[],presets:[]},loading:true,error:''});
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    const load=async()=>{
      setState(s=>({...s,loading:true,error:''}));
      try {const data=await loadPlanningRange(db,from,to);if(!cancelled)setState({data,loading:false,error:''});}
      catch(e){if(!cancelled)setState(s=>({...s,loading:false,error:e.message || 'Jadwal gagal dimuat'}));}
    };
    load();
    const interval=setInterval(()=>{if(!document.hidden)load();},30000);
    return()=>{cancelled=true;clearInterval(interval);};
  },[db,from,to,refresh,revision]);
  return {...state,reload:()=>setRefresh(n=>n+1)};
}
