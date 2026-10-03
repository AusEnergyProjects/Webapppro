import {CustomerQuoteHub} from "@/components/CustomerQuoteHub";
export const dynamic="force-dynamic";
export const metadata={title:"Your project | TLink",robots:{index:false,follow:false,noarchive:true,nosnippet:true},referrer:"no-referrer"};
export default async function Page({params}:{params:Promise<{token:string}>}){return <CustomerQuoteHub token={(await params).token}/>;}
