import CallbackApp from "@/components/callback-app";
import { getChatGPTUser, chatGPTSignInPath } from "./chatgpt-auth";
export const dynamic = "force-dynamic";
export default async function Home({searchParams}:{searchParams:Promise<{demo?:string}>}){
  const demo=(await searchParams).demo==="1";
  const user=await getChatGPTUser();
  if(!user)return <main className="sign-in"><p className="eyebrow">WEVER LABS</p><h1>Callback</h1><p>{demo?"Sign in to try fictional inquiries and simulated calls in your own sample workspace. No calling credits are needed.":"Your customer conversations, all in one place."}</p><a className="primary-link" href={chatGPTSignInPath(demo?"/?demo=1":"/")} target="_top">{demo?"Sign in for the sample workspace":"Sign in to your workspace"}</a><p className="sign-in-demo"><a className="text-link" href="/demo">See the sample walkthrough</a></p></main>;
  return <CallbackApp initialSample={demo}/>;
}
