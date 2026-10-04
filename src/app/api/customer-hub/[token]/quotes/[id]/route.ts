import {getD1} from "../../../../../../../db";
import {hubQuoteView,hubError,hubJson} from "@/lib/customer-quote-hub-server";
import {hubQuoteComparison} from "@/lib/customer-quote-comparison-server";
export const runtime="edge";
export async function GET(request:Request,context:{params:Promise<{token:string;id:string}>}){try{const {token,id}=await context.params;return hubJson(new URL(request.url).searchParams.get('summary')==='1'?{ok:true,comparison:await hubQuoteComparison(getD1(),token,id)}:await hubQuoteView(getD1(),token,id));}catch(error){return hubError(error);}}
