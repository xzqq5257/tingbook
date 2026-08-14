export async function onRequestPost({ env }) {
  try {
    if (!env.TINGBOOK_KV) return new Response(JSON.stringify({ok:false,error:"no KV binding"}), {status:500, headers:{"content-type":"application/json"}});
    await env.TINGBOOK_KV.delete("cosyvoice:voice_id");
    return new Response(JSON.stringify({ok:true, cleared:"cosyvoice:voice_id"}), {status:200, headers:{"content-type":"application/json"}});
  } catch (e) {
    return new Response(JSON.stringify({ok:false, error:String(e && e.message ? e.message : e)}), {status:500, headers:{"content-type":"application/json"}});
  }
}
export const onRequest = (ctx) => ctx.request.method === "POST"
  ? onRequestPost(ctx)
  : new Response(JSON.stringify({ok:false, error:"use POST"}), {status:405, headers:{"content-type":"application/json"}});
