export async function register() {
  if(process.env.NEXT_RUNTIME==='nodejs') {
    const {startPushWorker}=await import('./lib/push/server');startPushWorker();
  }
}
