import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import EditInvoiceModal from '../../src/views/EditInvoiceModal.jsx';
function Fixture(){
 const initial=window.fixture;
 const [open,setOpen]=useState(true),[form,setForm]=useState(initial.form),[items,setItems]=useState(initial.items),[jasa,setJasa]=useState(initial.jasa),[invoices,setInvoices]=useState([initial.invoice]);
 window.fixtureState=()=>({form,invoices,open,notices:window.notices||[]});
 return <EditInvoiceModal open={open} onClose={()=>setOpen(false)} editInvoiceData={initial.invoice} editInvoiceForm={form} setEditInvoiceForm={setForm} editInvoiceItems={items} setEditInvoiceItems={setItems} editJasaItems={jasa} setEditJasaItems={setJasa} priceListData={[]} inventoryData={[]} customersData={[]} lookupHargaGlobal={()=>0} parseMD={v=>JSON.parse(v||'[]')} fmt={v=>String(v)} currentUser={{role:'Owner',name:'Owner Fiktif'}} supabase={{}} showNotif={v=>(window.notices||=[]).push(v)} addAgentLog={()=>{}} updateInvoice={()=>{throw new Error('Voucher must use atomic endpoint')}} setInvoicesData={setInvoices} auditUserName={()=>'Owner Fiktif'} _apiHeaders={async()=>({'Content-Type':'application/json'})}/>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
