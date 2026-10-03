// Console copies only: never alter the private journal or analysis evidence.
export function displayJSON(value){
 const mask=text=>text.replace(/(?<!\w)(?:\+\d{1,3}[\s().-]*)?(?:\(?\d{2,4}\)?[\s.-]*){2,4}\d{2,4}(?!\w)/g,match=>{
  const digits=match.replace(/\D/g,'');
  return digits.length>=7&&digits.length<=15?'[phone masked]':match;
 });
 return JSON.stringify(value,(_key,item)=>typeof item==='string'?mask(item):item,2);
}
