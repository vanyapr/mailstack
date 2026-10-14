export type RecipientCommit = {values:string[];error?:string};

const address=(value:string)=>value.trim();
const key=(value:string)=>address(value).toLocaleLowerCase();

export function recipientValues(value:string) {
  const seen=new Set<string>();
  return value.split(/[;,]/).map(address).filter(value=>{
    const normalized=key(value);
    if(!normalized||seen.has(normalized))return false;
    seen.add(normalized);return true;
  });
}

export function serializeRecipients(values:string[]) { return recipientValues(values.join(',')).join(', '); }

export function commitRecipients(values:string[], input:string):RecipientCommit {
  const next=input.split(/[;,]/).map(address).filter(Boolean);
  if(!next.length)return {values};
  const invalid=next.find(value=>!/^\S+@\S+$/.test(value));
  if(invalid)return {values,error:'Укажите корректный email-адрес.'};
  const merged=recipientValues([...values,...next].join(','));
  if(merged.length>100)return {values,error:'В одном поле допускается до 100 адресов.'};
  return {values:merged};
}
