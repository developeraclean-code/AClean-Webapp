import { describe,it,expect,vi } from 'vitest';
import { planningTeams, planningWeek, planningWeekOffset, teamReadiness, teamSlotCrew, suggestedTeamSlots, planConflict, validatePlan, planSnapshot, loadPlanningRange } from '../teamPlanning.js';
const presets=Array.from({length:8},(_,i)=>({slot:`Team ${String(i+1).padStart(2,'0')}`}));
const rosters=[{date:'2099-10-12',slot:'Team 01',member1:'Rian',member1_role:'teknisi',member2:'Danu',member2_role:'helper'},{date:'2099-10-13',slot:'Team 01',member1:'Budi',member1_role:'teknisi',member2:'Sari',member2_role:'helper'}];
const plan={id:'new',customer:'Andi',phone:'6281234567890',date:'2099-10-12',time:'09:00',time_end:'11:00',service:'Cleaning',units:2,team_slot:'Team 01'};
describe('team-first weekly planning',()=>{
  it('uses configured teams, grows numerically, and retains occupied historical slots',()=>{
    expect(planningTeams(presets)).toHaveLength(8);
    expect(planningTeams(presets)).not.toContain('Team 09');
    expect(planningTeams([...presets,{slot:'Team 12'},{slot:'Team 09'}],[],[{team_slot:'Maintenance 01'}])).toContain('Maintenance 01');
    expect(planningTeams([...presets,{slot:'Team 12'},{slot:'Team 09'}]).slice(-2)).toEqual(['Team 09','Team 12']);
  });
  it('calculates weeks from date-only WIB values over a year boundary',()=>{
    expect(planningWeek('2026-10-05')[0].date).toBe('2026-10-05');
    expect(planningWeek('2027-01-01')[0].date).toBe('2026-12-28');
    const offset=planningWeekOffset('2026-10-04','2099-10-12');
    expect(planningWeek('2026-10-04',offset).map(d=>d.date)).toContain('2099-10-12');
  });
  it('uses different personnel each day and flags absence without cancelling the job',()=>{
    expect(teamReadiness('Team 01','2099-10-12',rosters,[]).members.map(m=>m.name)).toEqual(['Rian','Danu']);
    const readiness=teamReadiness('Team 01','2099-10-13',rosters,[{date:'2099-10-13',teknisi:'Budi',status:'SAKIT'}]);
    expect(readiness.label).toBe('Perlu pengganti');expect(readiness.members.map(m=>m.name)).toEqual(['Budi','Sari']);
    expect(teamReadiness('Team 02','2099-10-12',rosters,[]).label).toBe('Anggota belum diisi');
  });
  it('shows the dated roster first, then a clearly tentative preset, and blocks absent crew',()=>{
    const teamPresets=[{slot:'Team 01',teknisi:'Rey'},{slot:'Team 02',teknisi:'Agung'}];
    expect(teamSlotCrew('Team 01','2099-10-12',rosters,[],teamPresets)).toMatchObject({names:['Rian'],source:'roster',blocked:false});
    expect(teamSlotCrew('Team 01','2099-10-13',rosters,[{date:'2099-10-13',teknisi:'Budi',status:'SAKIT'}],teamPresets)).toMatchObject({names:['Budi'],blocked:true});
    expect(teamSlotCrew('Team 02','2099-10-12',rosters,[],teamPresets)).toMatchObject({names:['Agung'],source:'preset',blocked:false,detail:expect.stringContaining('belum diisi')});
    expect(teamSlotCrew('Team 02','2099-10-12',rosters,[{date:'2099-10-12',teknisi:'Agung',status:'OFF'}],teamPresets).blocked).toBe(true);
    expect(teamSlotCrew('Team 03','2099-10-12',rosters,[],teamPresets)).toMatchObject({names:[],source:'empty',blocked:false});
  });
  it('suggests exact duration, permits teams without members, rejects same-team and helper overlaps',()=>{
    const jobs=[{...plan,id:'old',status:'PENDING'}];
    const slots=suggestedTeamSlots({date:plan.date,team:'Team 01',service:'Cleaning',units:2,orders:jobs,rosters});
    expect(slots[0]).toMatchObject({time:'11:00',time_end:'13:00'});
    expect(planConflict(plan,[{...jobs[0],team_slot:'Team 02',helper:'Danu'}],rosters)).toMatch(/bertabrakan/);
    expect(suggestedTeamSlots({date:plan.date,team:'Team 08',service:'Cleaning',units:3,orders:jobs,rosters})[0]).toMatchObject({time:'09:00',time_end:'12:00'});
    expect(planConflict({...plan,id:'old'},jobs,rosters)).toBeNull();
  });
  it('ignores cancelled jobs, handles night shifts, and blocks a full team',()=>{
    expect(planConflict(plan,[{...plan,id:'other',status:'CANCELLED'}],rosters)).toBeNull();
    expect(planConflict(plan,Array.from({length:6},(_,i)=>({...plan,id:String(i),status:'PENDING'})),rosters)).toContain('6 pekerjaan');
    expect(suggestedTeamSlots({date:plan.date,team:'Malam 01',service:'Cleaning',units:2,orders:[],rosters})[0]).toMatchObject({time:'18:00',time_end:'20:00'});
    expect(suggestedTeamSlots({date:'2000-01-01',team:'Team 01',service:'Cleaning',units:1,orders:[],rosters})).toEqual([]);
  });
  it('validates mandatory fields and prevents invalid/cross-midnight times',()=>{
    expect(validatePlan(plan)).toBeNull();
    for(const patch of [{date:''},{date:'2099-02-30'},{units:0},{units:1.5},{time_end:'08:00'},{time_end:'25:00'},{time:'17:00',time_end:'19:00'},{time:'18:00',time_end:'20:00'}])expect(validatePlan({...plan,...patch})).toBeTruthy();
    expect(planSnapshot({...plan,status:'CONFIRMED',helper:'Danu'})).toMatchObject({status:'CONFIRMED',helper:'Danu',notes:null});
  });
  it('fails closed on read errors or a truncated range',async()=>{
    const q={select:vi.fn().mockReturnThis(),gte:vi.fn().mockReturnThis(),lte:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn().mockResolvedValue({error:{message:'offline'}})};
    await expect(loadPlanningRange({from:()=>q},plan.date,plan.date)).rejects.toThrow('offline');
    q.limit.mockResolvedValue({data:Array(1000).fill({})});
    await expect(loadPlanningRange({from:()=>q},plan.date,plan.date)).rejects.toThrow('melebihi batas');
  });
});
