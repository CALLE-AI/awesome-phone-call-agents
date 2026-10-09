import Console from './console';
import { getErrand } from './actions';

export default async function Page() {
  const errand = await getErrand();
  return <Console errand={errand} />;
}
