import { describe, expect, it } from 'vitest';
import { dashboardReadError } from '../dashboardReadError.js';
describe('Dashboard error classification',()=>{
  it.each(['PGRST202','42883'])('only missing function %s suggests migration',code=>{
    expect(dashboardReadError({code}).kind).toBe('missing_function');
  });
  it('identifies 57014 without claiming migration missing',()=>{
    const result=dashboardReadError({code:'57014',message:'canceling statement due to statement timeout'});
    expect(result.kind).toBe('timeout');expect(result.message).not.toMatch(/Pastikan.*181/);
  });
  it.each(['503','504','APP_READ_PAUSED','APP_READ_NETWORK'])('identifies connectivity %s',code=>expect(dashboardReadError({code}).kind).toBe('unavailable'));
  it.each(['42501','401','403'])('identifies access %s',code=>expect(dashboardReadError({code}).kind).toBe('access'));
  it('handles network and unknown errors without exposing raw provider details',()=>{
    expect(dashboardReadError(new Error('Failed to fetch')).kind).toBe('unavailable');
    expect(dashboardReadError(new Error('private provider payload')).message).not.toMatch(/private provider/);
  });
});
