import {cors} from './proxy.js'
let lastSearch=0
const cache=new Map<string,{at:number;data:unknown}>()
export async function maps(req:Request):Promise<Response>{const allowed=cors(req),headers=allowed.headers;if(!allowed.ok)return Response.json({error:'Origin not allowed'},{status:403,headers});if(req.method==='OPTIONS')return new Response(null,{status:204,headers})
 try{const input=await req.json();if(input.kind==='search'){
 const query=String(input.query??'').trim().slice(0,160);if(query.length<2)return Response.json({error:'Enter a place'},{status:400,headers})
 const saved=cache.get(query);if(saved&&Date.now()-saved.at<86400000)return Response.json(saved.data,{headers})
 if(Date.now()-lastSearch<1100)return Response.json({error:'Please wait a moment before another search.'},{status:429,headers});lastSearch=Date.now()
 const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ph&limit=5&q=${encodeURIComponent(query)}`,{headers:{'User-Agent':'PalDo/1.0 (user-initiated Philippine place search)'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('Place search unavailable')
 const data=(await r.json() as {place_id:number;display_name:string;lat:string;lon:string}[]).map(p=>({id:String(p.place_id),label:p.display_name,lat:Number(p.lat),lon:Number(p.lon)}));cache.set(query,{at:Date.now(),data});return Response.json(data,{headers})
 }
 if(input.kind==='route'){
 if(input.mode!=='driving')return Response.json({error:'Automatic routing currently supports driving only. Enter your own estimate for transit, walking or cycling.'},{status:422,headers})
 const points=[input.origin,input.destination];if(points.some(p=>!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||Math.abs(p.lat)>90||Math.abs(p.lon)>180))return Response.json({error:'Confirm route endpoints'},{status:400,headers})
 const base=process.env.PAL_OSRM_URL??'https://router.project-osrm.org';const r=await fetch(`${base}/route/v1/driving/${points.map(p=>`${p.lon},${p.lat}`).join(';')}?overview=false`,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Routing unavailable');const d=await r.json(),route=d.routes?.[0];if(d.code!=='Ok'||!Number.isFinite(route?.duration)||route.duration<=0||!Number.isFinite(route.distance))throw new Error('No route found')
 return Response.json({provider:'OSRM / OpenStreetMap',fetchedAt:Date.now(),durationSeconds:route.duration,distanceMeters:route.distance,departureAt:input.departure,trafficBasis:'baseline',mode:'driving'},{headers})
 }return Response.json({error:'Unsupported request'},{status:400,headers})
 }catch{return Response.json({error:'Maps estimate unavailable. Please try again or enter your own duration.'},{status:503,headers})}}
