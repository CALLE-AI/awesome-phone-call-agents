import { ResultSchema } from './types';
export function validateSchema(s:ResultSchema):void {
 if(s.type!=='object') throw new Error('CALL-E result schemas must be object schemas');
 if(s.additionalProperties===true) throw new Error('additionalProperties:true is not supported');
 if(s.properties && typeof s.properties!=='object') throw new Error('properties must be an object');
 for(const key of s.required??[]) if(!(key in s.properties)) throw new Error(`Required field ${key} missing from properties`);
}
export const outcomeField={type:'string',enum:['yes','no','unknown'],description:'Use unknown when evidence is insufficient.'};
