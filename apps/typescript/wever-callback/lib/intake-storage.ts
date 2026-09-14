import { database } from "./storage";

export async function readIntake(token:string){
  if(!/^[a-f0-9]{64}$/.test(token))return null;
  return database().prepare("SELECT owner, name, introduction FROM intake_links WHERE token = ? AND enabled = 1").bind(token).first<{owner:string;name:string;introduction:string}>();
}
