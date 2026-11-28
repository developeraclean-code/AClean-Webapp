import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import QuotationView from '../../src/views/QuotationView.jsx';
function Preview() {
  const [role, setRole] = useState('Owner');
  const [notice, setNotice] = useState('');
  return <main><p>Simulasi lokal dengan data fiktif</p><label>Role simulasi <select value={role} onChange={e => setRole(e.target.value)}>{['Owner','Admin','Finance','Teknisi','Supervisor',''].map(value => <option key={value} value={value}>{value || 'Tanpa role'}</option>)}</select></label><div role="alert">{notice}</div><QuotationView currentUser={{role}} quotationsData={[]} customersData={[]} priceListData={[]} supabase={null} showNotif={setNotice} /></main>;
}
createRoot(document.getElementById('root')).render(<Preview />);
