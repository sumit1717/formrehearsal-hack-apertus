/** Authored synthetic engineering example. No Apertus output or human review. */
import {createReviewStore} from '../../src/recorded-review.mjs';
import {validateCurrentInput} from '../../src/current-admission.mjs';
const eq=(field,value)=>({op:'eq',field,value});
const all=(...args)=>({op:'all',args});
const any=(...args)=>({op:'any',args});
export const OLD_ASSISTANCE='Show unloading assistance exactly for courier deliveries of heavy equipment.';
export const NEW_ASSISTANCE='Show unloading assistance exactly for courier deliveries of heavy equipment, except where a loading dock is available.';
export const CONTACT='Show handling contact exactly when unloading assistance is needed or a courier delivery has no loading dock.';
export const REQUIRED='Unloading assistance and handling contact are required whenever they are shown. Access instructions are optional.';
export const UNRESOLVED='Show access instructions where site access makes special arrangements necessary.';
export function equipmentDeliveryInput({revised=false}={}){
  return {policyText:[revised?NEW_ASSISTANCE:OLD_ASSISTANCE,CONTACT,REQUIRED,UNRESOLVED].join('\n'),
    driverText:'delivery_method,equipment_weight,loading_dock,urgent',formText:JSON.stringify({title:'Equipment delivery request',elements:[
      {type:'radiogroup',name:'delivery_method',title:'Delivery method',choices:['pickup','courier']},
      {type:'radiogroup',name:'equipment_weight',title:'Equipment weight',choices:['light','heavy']},
      {type:'boolean',name:'loading_dock',title:'Loading dock available'},
      {type:'boolean',name:'urgent',title:'Urgent delivery'},
      {type:'boolean',name:'unloading_assistance',title:'Unloading assistance',visibleIf:"{delivery_method} = 'courier' and {equipment_weight} = 'heavy'",isRequired:true},
      {type:'boolean',name:'handling_contact',title:'Handling contact',visibleIf:"{delivery_method} = 'courier' and ({equipment_weight} = 'heavy' or {loading_dock} = false)",isRequired:true},
      {type:'boolean',name:'access_instructions',title:'Access instructions'},
    ]},null,2)};
}
export function equipmentDeliveryRules({revised=false}={}){
  const courier=eq('delivery_method','courier'),heavy=eq('equipment_weight','heavy'),noDock=eq('loading_dock',false);
  const assistance=all(courier,heavy,...(revised?[noDock]:[]));
  const quote=[revised?NEW_ASSISTANCE:OLD_ASSISTANCE,CONTACT].join('\n');
  return [
    {field:'unloading_assistance',property:'visible',condition:assistance,quote:revised?NEW_ASSISTANCE:OLD_ASSISTANCE},
    {field:'handling_contact',property:'visible',condition:any(assistance,all(courier,noDock)),quote},
    ...['unloading_assistance','handling_contact'].map(field=>({field,property:'required',condition:true,quote:REQUIRED})),
    {field:'access_instructions',property:'required',condition:false,quote:REQUIRED},
  ];
}
/** Executes the existing review workflow in explicitly declared agent-simulation mode. */
export function approveSyntheticEquipment({revised=false,body=equipmentDeliveryInput({revised}),rules=equipmentDeliveryRules({revised})}={}){
  const input=validateCurrentInput(body),reviews=createReviewStore([],[],{now:()=>Date.parse('2026-10-12T00:00:00Z'),simulation:true});
  const revision=s=>({sessionId:s.sessionId,expectedRevision:s.revision});
  let state=reviews.startManual({inputId:input.inputId,actorKind:'agent-simulation',humanAttestation:false},input);
  state=reviews.draft({...revision(state),draftText:JSON.stringify({version:1,kind:'independent-rules-v1',rules})});
  for(const slot of state.coverage.filter(slot=>!slot.present)){
    const start=input.family.policy.indexOf(UNRESOLVED);
    state=reviews.draft({...revision(state),policySha256:state.policySha256,resolution:{field:slot.field,property:slot.property,
      classification:'ambiguous',reasonCode:'ambiguous',reason:'The policy does not define special arrangements in terms of these declared drivers; keep this slot unknown.',
      selection:start<0?null:{start,end:start+UNRESOLVED.length}}});
  }
  state=reviews.approve({...revision(state),rulesSha256:state.rulesSha256,reviewedInterpretation:true,reviewedCoverage:true});
  return reviews['export-specification']({...revision(state),approvalHash:state.approval.approvalHash});
}
export function createEquipmentDeliveryExample(){
  const oldSpecification=approveSyntheticEquipment(),newSpecification=approveSyntheticEquipment({revised:true});
  return {oldSpecification,newSpecification,formText:equipmentDeliveryInput().formText};
}
