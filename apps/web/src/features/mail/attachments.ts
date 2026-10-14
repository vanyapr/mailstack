import type { Mail } from '@/lib/mox/mail';
export async function loadAttachments(message:Pick<Mail,'id'|'attachments'>):Promise<File[]> {
  if(message.attachments.length>20)throw Error('В письме больше 20 вложений. Скачайте нужные файлы отдельно.');
  if(message.attachments.reduce((total,file)=>total+Math.max(0,file.size),0)>15*1024*1024)throw Error('Вложения превышают 15 МБ. Скачайте нужные файлы отдельно.');
  let total=0;
  return Promise.all(message.attachments.map(async file=>{
    const response=await fetch(`/api/mail/attachment/${message.id}/${file.path}`);
    if(!response.ok)throw Error('Не удалось загрузить вложения. Откройте письмо снова; сохранённые файлы остаются на сервере.');
    const blob=await response.blob();total+=blob.size;
    if(total>15*1024*1024)throw Error('Общий размер вложений превышает 15 МБ.');
    return new File([blob],file.name,{type:file.type||'application/octet-stream'});
  }));
}
