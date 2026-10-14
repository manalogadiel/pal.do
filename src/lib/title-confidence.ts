export function titleNeedsConfirmation(raw:string,title:string):boolean{
 if(/\b(?:title|called|named|pangalan|pamagat)\b/i.test(raw))return false
 if(/^(?:will|would|it|this|that|start|end|starts|ends|ito|iyan|basta|baka|something|event|plan)$/i.test(title.trim()))return true
 if(/^\s*(?:ito|iyan)\s+(?:ang|yung)\b/i.test(raw))return true
 const meaningful=title.toLowerCase().split(/\W+/).filter(w=>w.length>2)
 return !!meaningful.length&&!meaningful.some(w=>raw.toLowerCase().includes(w))
}
