import {getD1} from "../../../../../../../db";
import {hubQuoteView,hubError,hubJson} from "@/lib/customer-quote-hub-server";
export const runtime="edge";
export async function GET(_request:Request,context:{params:Promise<{token:string;id:string}>}){try{const {token,id}=await context.params;return hubJson(await hubQuoteView(getD1(),token,id));}catch(error){return hubError(error);}}
