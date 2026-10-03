import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";

// This development adapter represents one local workspace. It is never part of
// a production build and only accepts a loopback connection and loopback Host.
function localWorkspace():Plugin{
  return {name:"callback-local-workspace",enforce:"pre",apply:"serve",configureServer(server){
    if(server.config.server.host!=="127.0.0.1")throw new Error("The community preview must bind to 127.0.0.1.");
    server.middlewares.use((request,response,next)=>{
      const localAddress=["127.0.0.1","::1","::ffff:127.0.0.1"].includes(request.socket.remoteAddress??"");
      const localHost=/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host??"");
      if(!localAddress||!localHost){response.statusCode=403;response.end("This preview is available on this computer only.");return;}
      for(const key of Object.keys(request.headers))if(key.startsWith("oai-authenticated-")||key.startsWith("x-forwarded-"))delete request.headers[key];
      request.headers["oai-authenticated-user-id"]="local-preview-owner";
      request.headers["oai-authenticated-user-email"]="preview@example.invalid";
      request.headers["oai-authenticated-user-full-name"]="Local%20preview";
      request.headers["oai-authenticated-user-full-name-encoding"]="percent-encoded-utf-8";
      // The Worker adapter builds its Request from rawHeaders, not headers.
      request.rawHeaders=Object.entries(request.headers).flatMap(([key,value])=>value===undefined?[]:Array.isArray(value)?value.flatMap(item=>[key,item]):[key,value]);
      next();
    });
  }};
}
export default defineConfig(async()=>{
  const {cloudflare}=await import("@cloudflare/vite-plugin");
  return {server:{host:"127.0.0.1",port:4175,strictPort:true},plugins:[localWorkspace(),vinext(),cloudflare({viteEnvironment:{name:"rsc",childEnvironments:["ssr"]},inspectorPort:false})]};
});
