import {getD1} from "../../../../../../db";
import {sameOrigin} from "@/lib/admin-server";
import {authoriseCustomerHub} from "@/lib/customer-hub-links";
import {hubError,hubJson,hubWriteGuard,loadCustomerQuoteHub} from "@/lib/customer-quote-hub-server";
import {getCustomerProjectEvidenceBucket} from "@/lib/customer-project-evidence-bucket";
import {hasAllowedSignature,sanitiseQuotingPhoto} from "@/lib/private-image-evidence";
export const runtime="edge";
type Context={params:Promise<{token:string}>};
export async function GET(request:Request,context:Context){try{
  const db=getD1(),token=(await context.params).token,hub=await authoriseCustomerHub(db,token);
  const file=await db.prepare("SELECT file_name,content_type,object_key FROM customer_hub_files WHERE id=? AND opportunity_id=?")
    .bind(new URL(request.url).searchParams.get("id"),hub.opportunity_id).first<{file_name:string;content_type:string;object_key:string}>();
  if(!file)throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  const object=await getCustomerProjectEvidenceBucket().get(file.object_key);
  if(!object)throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  await authoriseCustomerHub(db,token);
  return new Response(object.body,{headers:{"Content-Type":file.content_type,"Content-Disposition":`attachment; filename="${file.file_name.replace(/[^a-zA-Z0-9._-]/g,"_")}"`,
    "Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
}catch(error){return hubError(error);}}
export async function POST(request:Request,context:Context){
  if(!sameOrigin(request))return hubJson({ok:false,error:"Request origin was not accepted."},403);
  try{const db=getD1(),hub=await authoriseCustomerHub(db,(await context.params).token),form=await request.formData();
    const id=String(form.get("questionId")||""),file=form.get("file");
    if(!(file instanceof File)||file.size<=0||file.size>8*1024*1024||!["image/jpeg","image/png","image/webp","application/pdf"].includes(file.type))return hubJson({ok:false,error:"Choose a photo or PDF up to 8 MB."},400);
    const question=await db.prepare("SELECT kind FROM customer_hub_questions WHERE id=? AND opportunity_id=?").bind(id,hub.opportunity_id).first<{kind:string}>();
    if(!question||question.kind==='text'||(question.kind==='photo'&&!file.type.startsWith('image/')))return hubJson({ok:false,error:"Choose a file matching the requested information."},400);
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(!hasAllowedSignature(bytes,file.type))return hubJson({ok:false,error:"The file contents do not match a supported photo or PDF."},400);
    const safe=file.type==='application/pdf'?bytes:sanitiseQuotingPhoto(bytes,file.type);
    if(!safe)return hubJson({ok:false,error:"This photo could not be prepared. Please choose another."},400);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",Uint8Array.from(safe).buffer)),b=>b.toString(16).padStart(2,'0')).join('');
    const duplicate=()=>db.prepare("SELECT id FROM customer_hub_files WHERE question_id=? AND opportunity_id=? AND sha256=?").bind(id,hub.opportunity_id,hash).first();
    if(await duplicate())return hubJson({ok:true,hub:await loadCustomerQuoteHub(db,hub)});
    const fileId=crypto.randomUUID(),now=new Date().toISOString(),key=`customer-hub/${hub.id}/${fileId}`;
    const bucket=getCustomerProjectEvidenceBucket();
    await bucket.put(key,Uint8Array.from(safe).buffer,{httpMetadata:{contentType:file.type}});
    try{await db.batch([hubWriteGuard(db,hub,true),
      db.prepare(`INSERT INTO customer_hub_files(id,question_id,opportunity_id,file_name,content_type,size_bytes,object_key,sha256,created_at)
        SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM customer_hub_files WHERE opportunity_id=?)<60
          AND (SELECT COUNT(*) FROM customer_hub_files WHERE question_id=?)<6`)
        .bind(fileId,id,hub.opportunity_id,file.name.replace(/[\r\n\x00-\x1f]/g,'').slice(0,120)||'Customer file',file.type,safe.byteLength,key,hash,now,hub.opportunity_id,id),
      db.prepare(`INSERT INTO customer_hub_events(id,opportunity_id,question_id,event_type,created_at) VALUES(?,?,?,CASE WHEN changes()=1 THEN 'file_added' ELSE NULL END,?)`)
        .bind(crypto.randomUUID(),hub.opportunity_id,id,now)]);
    }catch(error){
      const committed=await db.prepare('SELECT id FROM customer_hub_files WHERE id=? AND object_key=?').bind(fileId,key).first();
      if(!committed){await bucket.delete(key);if(!await duplicate())throw error;}
    }
    return hubJson({ok:true,hub:await loadCustomerQuoteHub(db,hub)},201);
  }catch(error){if(error instanceof Error&&error.message.includes('NOT NULL'))return hubJson({ok:false,error:"The project closed or reached its file limit. Refresh before sharing."},409);return hubError(error);}
}
