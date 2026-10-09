// A snapshot for clarifying a requested time, never a claim about call pickup time.
export function callCalendarContext(timezone:string,preparedAt=new Date()){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(preparedAt);
  const part=(type:string)=>Number(parts.find(p=>p.type===type)!.value);
  const localDay=new Date(Date.UTC(part("year"),part("month")-1,part("day")));
  const nextDay=new Date(localDay);nextDay.setUTCDate(nextDay.getUTCDate()+1);
  const label=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",weekday:"long",year:"numeric",month:"long",day:"numeric"});
  return {
    prepared_at_utc:preparedAt.toISOString(),
    customer_timezone:timezone,
    local_date_at_preparation:label.format(localDay),
    following_local_calendar_date:label.format(nextDay),
  };
}
