import {publicState} from '../../../lib/news-store';
import {publicStateResponse} from '../../../lib/public-state-http.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return publicStateResponse(request,publicState);}
