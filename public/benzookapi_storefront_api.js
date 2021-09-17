/* My own Storefront API wrappers inteded to be used from client HTML directly */

const storefront_api_call = function(shop, storefront_access_token, version, graphql, variables) { 
  const endpoint = `https://${shop}/api/${version}/graphql.json`;
  const request = new XMLHttpRequest();         
  request.open("POST", `${endpoint}`, false);     
  request.setRequestHeader('X-Shopify-Storefront-Access-Token', `${storefront_access_token}`);
  request.setRequestHeader('Content-Type', ' application/json');
  let data = {};
  data.query = graphql.replace(/\n/g, '');
  if (variables != null) {
    data.variables = variables;
  }
  try {
    console.log(`Acessing... ${endpoint} with ${JSON.stringify(data)}`);
    request.send(JSON.stringify(data));
    if (request.status == 200) {
      console.log(request.responseText);
      let res = JSON.parse(request.responseText);
      return res;
    } else {
      alert(request.response);
    }
  } catch(err) {
    alert("Request failed");
  }           
};

        

