import { createServer } from "node:http";

const checkout = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fieldwork checkout</title><style>
*{box-sizing:border-box}body{margin:0;background:#f7f5ef;color:#282a22;font:16px/1.5 system-ui,sans-serif}
header{padding:20px max(20px,calc((100% - 900px)/2));background:#26352b;color:white;font-weight:700}
main{max-width:920px;margin:52px auto;padding:0 18px;display:grid;grid-template-columns:1.1fr .9fr;gap:16px}
section{padding:24px;background:#fffdfa;border:1px solid #ddd9cd;border-radius:14px}h1,h2,p{margin-top:0}
label{display:grid;gap:5px;margin-top:16px}input{font:inherit;padding:9px;border:1px solid #cdc9bc;border-radius:7px;width:100%}
button{font:inherit;cursor:pointer}#pay{display:block;margin-top:16px;padding:9px 14px;border:0;border-radius:8px;background:#26352b;color:#fff}
output{display:block;margin-top:12px}li{margin-bottom:6px}small{color:#655e50}.row{display:flex;justify-content:space-between}
@media(max-width:640px){main{grid-template-columns:1fr;margin-top:20px}}
</style></head><body><header>Fieldwork</header><main>
<section><h1>Checkout</h1><div class="row"><p>Canvas day pack</p><strong>$42.00</strong></div>
<form><label>Email<input type="email" name="email" value="demo@example.com" required></label>
<button id="pay" type="submit">Pay $42.00</button></form><output id="receipt" aria-live="polite"></output></section>
<section><h2>Payment history</h2><p><strong id="count">0</strong> payments</p><ol id="history"></ol>
<button id="reset" type="button">Reset test data</button><p><small>Payments in this checkout are simulated.</small></p></section>
</main><script>
async function render(){const payments=await fetch('/payments').then(res=>res.json());const list=document.querySelector('#history');
document.querySelector('#count').textContent=payments.length;list.replaceChildren(...payments.map(payment=>{const item=document.createElement('li');item.textContent=payment.id+' · $42.00';return item}));}
document.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.target);
const receipt=await fetch('/payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:data.get('email'),order:'fieldwork-demo'})}).then(res=>res.json());
document.querySelector('#receipt').textContent='Payment recorded · '+receipt.id;await render();});
document.querySelector('#reset').addEventListener('click',async()=>{await fetch('/reset',{method:'POST'});document.querySelector('#receipt').textContent='';await render();});
render();
</script></body></html>`;

const payments = [];
const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(checkout);
    return;
  }
  response.setHeader("Content-Type", "application/json");
  if (request.method === "GET" && request.url === "/payments") {
    response.end(JSON.stringify(payments));
  } else if (request.method === "POST" && request.url === "/payments") {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 4096) {
        response.writeHead(413).end("{}");
        return;
      }
    }
    try {
      const { order } = JSON.parse(body);
      // The QA sample deliberately records a new payment for every submission of the same order.
      const receipt = { id: `payment-${payments.length + 1}`, order };
      payments.push(receipt);
      response.end(JSON.stringify(receipt));
    } catch {
      response.writeHead(400).end("{}");
    }
  } else if (request.method === "POST" && request.url === "/reset") {
    payments.length = 0;
    response.end("{}");
  } else response.writeHead(404).end("{}");
});
server.listen(Number(process.env.PORT || 3000), "127.0.0.1");
