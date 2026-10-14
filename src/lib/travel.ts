import {uid} from './core'
export interface ResolvedPlace {id:string;label:string;lat:number;lon:number}
export interface RouteEstimate {provider:string;fetchedAt:number;durationSeconds:number;distanceMeters:number;departureAt?:number;trafficBasis:'future'|'current'|'baseline';mode:string}
export interface TravelDraft {id:string;rawText:string;notes?:string;date?:number;departure?:number;origin?:ResolvedPlace;destination?:ResolvedPlace;destinationQuery?:string;mode?:'driving'|'walking'|'cycling'|'transit';estimate?:RouteEstimate}

import {parseWhen} from './parse'
export function parseTravelIntent(text:string,now:number):TravelDraft|null{
 if(!/\b(aalis|papunta(?:ng)?|pupunta(?:ng)?|popunta(?:ng)?|bibiyahe|biyahe|travel(?:ling)?|trip|going to)\b/i.test(text))return null
 const match=text.match(/\b(?:papunta(?:ng)?|pupunta(?:ng)?|popunta(?:ng)?|to|patungo(?:ng)?)\s+(.+?)(?=\s+(?:sa\s+)?(?:october|november|december|january|february|march|april|may|june|july|august|september|bukas|tomorrow|on\b)|[,;.!]|$)/i)
 if(!match)return null
 if(/^(?:study|work|review|prepare|finish|do|have|meet|eat|sleep|play|watch|read|write|aral|mag-?aral|magtrabaho)\b/i.test(match[1].trim()))return null
 const when=parseWhen(text,now)
 // A bare "going to the beach someday" is talk, not a trip to plan: it needs a day, or a real travel word
 if(!when&&!/\b(aalis|papunta(?:ng)?|pupunta(?:ng)?|popunta(?:ng)?|bibiyahe|biyahe|travel(?:ling)?|trip)\b/i.test(text))return null
 return{id:uid(),rawText:text,date:when?.t,destinationQuery:match[1].trim(),departure:when?.hadTime?when.t:undefined}
}
