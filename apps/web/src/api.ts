export async function api<T>(path:string, init?:RequestInit):Promise<T>{
  const response=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const text=await response.text(); let body:any=null; try{body=text?JSON.parse(text):null}catch{body=text}
  if(!response.ok) throw new Error(body?.error || body?.message || `HTTP ${response.status}`);
  return body as T;
}
export const json=(method:string,body:unknown):RequestInit=>({method,body:JSON.stringify(body)});
export const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n||0);
export const num=(n:number,d=2)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:d}).format(n||0);
