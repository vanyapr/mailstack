import { adminClient } from '@/lib/mox/client';
export const dynamic='force-dynamic';
export async function GET() {
  // Version does require authentication. Only public process liveness is exposed;
  // authenticated admin status checks the actual Mox connection separately.
  return Response.json({status:'ok',application:'MailStack',version:'0.2.0-dev'},{headers:{'cache-control':'no-store'}});
}
