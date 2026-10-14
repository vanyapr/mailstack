import type { Metadata } from 'next';
import '@/features/mail/mail.css';
import '@/features/admin/admin.css';
import './product.css';
export const metadata:Metadata={title:'MailStack',description:'Почта на вашем сервере',robots:{index:false,follow:false},icons:{icon:'/mailstack-192.png',apple:'/mailstack-192.png'}};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="ru"><head><meta name="color-scheme" content="light dark"/></head><body>{children}</body></html>;}
