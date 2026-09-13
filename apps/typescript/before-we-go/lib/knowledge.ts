// Fictional, versioned business information. No live inventory or partner data.
export const restaurant = {
 name:'The Courtyard — fictional restaurant',version:'courtyard-demo-v1',
 facts:[
  {id:'entrance_table',label:'Entrance and seating',text:'The main entrance and ground-floor dining area are step-free. The upstairs dining room has two steps. A ground-floor table must be confirmed by a staff member; this demo has no live seating inventory.'},
  {id:'table_toilet',label:'Toilet route',text:'There is a toilet on the ground floor, but its doorway width, turning space and complete step-free route have not been verified in this fact sheet. Staff must check specific access requirements.'},
  {id:'no_lifting',label:'Lifting and carrying',text:'Do not suggest lifting or carrying a guest or their wheelchair as an access solution. If a step-free route cannot be confirmed, arrange human follow-up.'},
 ],
 general:'Fictional restaurant enquiry service. Opening hours, menu, prices, allergen handling, parking and availability are not provided. No booking can be made or confirmed through this prototype.'
} as const;
