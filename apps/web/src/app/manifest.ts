import type { MetadataRoute } from 'next';
export default function manifest():MetadataRoute.Manifest {
  return {id:'/mail',name:'MailStack',short_name:'MailStack',description:'Почта на вашем сервере',start_url:'/mail',scope:'/mail',display:'standalone',background_color:'#ffffff',theme_color:'#2463d4',icons:[{src:'/mailstack-192.png',sizes:'192x192',type:'image/png'},{src:'/mailstack-512.png',sizes:'512x512',type:'image/png'}]};
}
