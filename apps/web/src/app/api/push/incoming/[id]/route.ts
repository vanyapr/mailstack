import { pushStore } from '@/lib/push/store';
import { startPushWorker } from '@/lib/push/server';
import { body, object, identifier, AppError } from '@/lib/security/validation';
import { json, failure } from '@/lib/auth/session';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    const {id}=await context.params;
    if(!/^[A-Za-z0-9_-]{32}$/.test(id))throw new AppError(401,'Недопустимый источник события.');
    const store=pushStore();store.authorize(id,request.headers.get('authorization'));
    // Native Mox sends message content too. Parse it transiently; only Meta.MsgID
    // and the destination mailbox are used. No mail content is stored or logged.
    const data=await body(request,4*1024*1024),meta=object(data.Meta);
    if(data.Version!==0)throw new AppError(400,'Неподдерживаемое событие Mox.');
    const message=identifier(meta.MsgID);
    if(typeof meta.MailboxName!=='string')throw new AppError(400,'Не указана папка.');
    if(meta.MailboxName.toLowerCase()==='inbox')store.enqueue(id,message);
    startPushWorker();return json({ok:true});
  }catch(e){return failure(e);}
}
