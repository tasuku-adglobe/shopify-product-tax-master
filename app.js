'use strict';

const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const koaRequest = require('koa-http-request');
const views = require('koa-views');
const serve = require('koa-static');

const crypto = require('crypto');

const fs = require('fs');

const mongo = require('mongodb');

const router = new Router();
const app = module.exports = new Koa();

app.use(bodyParser());

app.use(koaRequest({
  
}));

app.use(views(__dirname + '/views', {
  map: {
    html: 'underscore'
  }
}));

app.use(serve(__dirname + '/public'));

const API_KEY = `${process.env.SHOPIFY_API_KEY}`;
const API_SECRET = `${process.env.SHOPIFY_API_SECRET}`;
const API_PERMISSION = `${process.env.SHOPIFY_API_PERMISSION}`;
const API_VERSION = `${process.env.SHOPIFY_API_VERSION}`

const CONTENT_TYPE_JSON = 'application/json';
const CONTENT_TYPE_FORM = 'application/x-www-form-urlencoded';

const GRAPHQL_PATH_ADMIN = `admin/api/${API_VERSION}/graphql.json`;
const RESTAPI_PATH_ADMIN = `admin/api/${API_VERSION}`;
const GRAPHQL_PATH_STOREFRONT = `api/${API_VERSION}/graphql.json`;

const UNDEFINED = 'undefined';

const HMAC_SECRET = API_SECRET;

// Mongo URL and DB name for date store
const MONGO_URL = `${process.env.SHOPIFY_MONGO_URL}`;
const MONGO_DB_NAME = `${process.env.SHOPIFY_MONGO_DB_NAME}`;
const MONGO_COLLECTION = 'shops';

// Whhether to use storefront API or not
const STOREFRONT_API = `${process.env.SHOPIFY_STOREFRONT_API}`;

const METAFIELD_NAMESPACE = 'ProductTaxRefApp';
const METAFIELD_KEY_IS_DYNAMIC = 'isDynamic';
const METAFIELD_KEY_WITH_TEXT = 'withText';
const METAFIELD_KEY_REPLACE_ALL = 'replaceAll';

const PROXY_KEY_SHOP = 'ShopifyProductTaxAppShop';
const PROXY_KEY_PRODUCTS = 'ShopifyProductTaxAppProducts';
const PROXY_KEY_VARIANTS = 'ShopifyProductTaxAppVariants';

// Set Timezone Japan
//process.env.TZ = 'Asia/Tokyo'; 


/*
 *
 * --- CDN App Bridge ---
 *
*/
router.get('/app_bridge',  async (ctx, next) => { 
  console.log("+++++++++ /app_bridge ++++++++++");
  let shop = ctx.request.query.shop;
  let locale = ctx.request.query.locale;
  await ctx.render('app_bridge', {
    api_key: API_KEY,
    id: ctx.request.query.id,
    shop: shop,
    locale: locale
  });
});

/*
 *
 * --- Auth by frontend App Bridge ---
 *
*/
router.get('/auth',  async (ctx, next) => { 
  console.log("+++++++++ /auth ++++++++++");
  let shop = ctx.request.query.shop;
  let locale = ctx.request.query.locale;
  await ctx.render('auth', {
    api_key: API_KEY,
    api_permission: API_PERMISSION,
    callback: `https://${ctx.request.hostname}/callback`,
    shop: shop,
    locale: locale
  });
});

/*
 *
 * --- Top ---
 *
*/
router.get('/',  async (ctx, next) => {  
  console.log("+++++++++ / ++++++++++");
  if (!checkSignature(ctx.request.query)) {
    ctx.status = 400;
    return;
  }

  let shop = ctx.request.query.shop;
  let locale = ctx.request.query.locale;

  var shop_data = await(getDB(shop)); 
  if (shop_data == null) {
    ctx.body = "No shop data";
  } else {
    var api_res = await(callRESTAPI(ctx, shop, 'countries', null, 'GET'));
    console.log(`${JSON.stringify(api_res)}`);
    let tax = api_res.countries[0].tax;
    let country = api_res.countries[0].code;

    api_res = await(callGraphql(ctx, shop, `{
      shop {
        currencyCode
        currencyFormats {
          moneyWithCurrencyFormat
        }
        taxesIncluded  
        privateMetafields(first:5, namespace:"${METAFIELD_NAMESPACE}") {
          edges {
            cursor
            node {
              ... on PrivateMetafield {
                namespace
                id
                key
                value
                valueType
              }
            }
          }      
        }
      }    
    }`));
    console.log(`${JSON.stringify(api_res)}`);
    let tax_included = api_res.data.shop.taxesIncluded;
    var is_dynamic = true;
    var with_text = false;
    var replace_all = true;
    let eSize = api_res.data.shop.privateMetafields.edges.length;    
    for (let i=0; i<eSize; i++) {
      if (api_res.data.shop.privateMetafields.edges[i].node.key == METAFIELD_KEY_IS_DYNAMIC) {
        is_dynamic = api_res.data.shop.privateMetafields.edges[i].node.value;
      }
      if (api_res.data.shop.privateMetafields.edges[i].node.key == METAFIELD_KEY_WITH_TEXT) {
        with_text = api_res.data.shop.privateMetafields.edges[i].node.value;
      }
      if (api_res.data.shop.privateMetafields.edges[i].node.key == METAFIELD_KEY_REPLACE_ALL) {
        replace_all = api_res.data.shop.privateMetafields.edges[i].node.value;
      }
    }    

    await ctx.render('top', {
      tax: tax,
      country: country,
      tax_included: tax_included,     
      is_dynamic: is_dynamic,
      with_text: with_text,
      replace_all: replace_all,       
      shop: shop,
      locale: locale
    });
  }
});

/* 
 *
 * --- Callback endpoint during the installation ---
 * 
*/
router.get('/callback',  async (ctx, next) => {
  console.log("+++++++++ /callback ++++++++++");
  if (!checkSignature(ctx.request.query)) {
    ctx.status = 400;
    return;
  }
  let req = {};
  req.client_id = API_KEY;
  req.client_secret = API_SECRET;
  req.code = ctx.request.query.code;

  const shop = ctx.request.query.shop;

  let res = await(accessEndpoint(ctx, `https://${shop}/admin/oauth/access_token`, req, null, CONTENT_TYPE_FORM)); 
  if (typeof res.access_token !== UNDEFINED) {
    var shop_data = await(getDB(shop)); 
    if (shop_data == null) {
      await(insertDB(shop, res));        
    } else {
      await(setDB(shop, res));  
    }

    // If you use Storefront API, get the storefront access token
    if (STOREFRONT_API == "true") {
      let storefront_res = await(callRESTAPI(ctx, shop, `storefront_access_tokens`, {
        "storefront_access_token": {
          "title": "My Storefront Token"
        }
      }));  
      if (typeof storefront_res.storefront_access_token.access_token !== UNDEFINED) {
        res.storefront_access_token = storefront_res.storefront_access_token.access_token;
        await(setDB(shop, res));  
      }
    }

    // Get app handle by GraphQL
    let api_res = await(callGraphql(ctx, shop, `{
      app {
        handle
      }
    }`));
    const redirect_url = `https://${shop}/admin/apps/${api_res.data.app.handle}`;

    const storefront_api_file = `benzookapi_storefront_api`;

    api_res = await(callGraphql(ctx, shop, `{
      files(first:100, query: "filename:${storefront_api_file}") {
        edges {
          node {
            ... on GenericFile {
              id
              url
            }
          }
        }
      }
    }`));
    console.log(`${JSON.stringify(api_res)}`);

    if (typeof api_res.data.files.edges !== UNDEFINED) {
      //forEach doesn't support async and await!
      const size = api_res.data.files.edges.length;
      let ids = [];
      for (let i=0; i<size; i++) {           
        console.log(`${api_res.data.files.edges[i].node.id}`);
        ids.push(api_res.data.files.edges[i].node.id);

      }     
      api_res = await(callGraphql(ctx, shop, `mutation fileDelete($fileIds: [ID!]!) {
          fileDelete(fileIds: $fileIds) {
            deletedFileIds
            userErrors {
              code
              field
              message
            }
          }
        }`, null, GRAPHQL_PATH_ADMIN, {
          "fileIds": ids
      })); 
      console.log(JSON.stringify(api_res));      
    }    

    api_res = await(callGraphql(ctx, shop, `mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { ... on GenericFile {
          alt
          createdAt
          id
          fileStatus
          url
         }
        }
        userErrors {
          code
          field
          message
        }
      }
    }`, null, GRAPHQL_PATH_ADMIN, {
      "files": [
        {
          "alt": `${storefront_api_file}.js`,
          "originalSource": `https://${ctx.request.hostname}/${storefront_api_file}.js`,
          "contentType": 'FILE'
        }
      ]
    })); 
    console.log(JSON.stringify(api_res));

    if (typeof api_res.data.fileCreate.files[0].id !== UNDEFINED) {
      res.js_id = api_res.data.fileCreate.files[0].id;
      await(setDB(shop, res));  
    }

    //let src_url = `https://${ctx.request.hostname}/tax.js`;

    // Get and delete the current my own JavaScript by REST API
    //api_res = await(callRESTAPI(ctx, shop, 'script_tags', null, 'GET'));
    //if (typeof api_res.script_tags !== UNDEFINED) {
      //forEach doesn't support async and await!
      /*let size = api_res.script_tags.length;
      for (let i=0; i<size; i++) {
        if (api_res.script_tags[i].src == src_url) await(callRESTAPI(ctx, shop, `script_tags/${api_res.script_tags[i].id}`, null, 'DELETE'));
      }*/
    //}
    //console.log(`${JSON.stringify(api_res)}`);

    // Insert my own JavaScript by REST API
    /*api_res = await(callRESTAPI(ctx, shop, 'script_tags', {
      "script_tag": {
        "event": "onload",
        "src": src_url
      }
    }));*/
    //console.log(`${JSON.stringify(api_res)}`);

    // Create one time billing by GraphQL mutation
    /*api_res = await(callGraphql(ctx, shop, `mutation {
      appPurchaseOneTimeCreate(
        test: true,
        name: "Product Tax Reflection One time"
        price: { amount: 200.00, currencyCode: USD}
        returnUrl: "${redirect_url}"
      ) {
        userErrors {
          field
          message
        }
        confirmationUrl
        appPurchaseOneTime {
          id
        }
      }
    }`));
    const confirm_url = api_res.data.appPurchaseOneTimeCreate.confirmationUrl;*/

    // Create reccurring billing by GraphQL mutation
    /*api_res = await(callGraphql(ctx, shop, `mutation {
      appSubscriptionCreate(
        test: true,
        name: "Product Tax Reflection Plan"
        trialDays: 7
        returnUrl: "${redirect_url}"
        lineItems: [{
          plan: {
            appRecurringPricingDetails: {
                price: { amount: 99.00, currencyCode: USD }
            }
          }
        }]
      ) {
        userErrors {
          field
          message
        }
        confirmationUrl
        appSubscription {
          id
        }
      }
    }`));    
    const confirm_url = api_res.data.appSubscriptionCreate.confirmationUrl;

    ctx.redirect(confirm_url);*/

    ctx.redirect(redirect_url);  

  } else {
    ctx.status = 500;
  }  
});

/* 
 * 
 * --- App proxy  ---
 * 
*/
router.get('/proxy',  async (ctx, next) => {
  console.log("---------- /proxy ------------");
  if (!checkAppProxySignature(ctx.request.query)) {
    ctx.status = 400;
    return;
  }

  let shop = ctx.request.query.shop;

  let data_key = ctx.request.query.data_key;
  let data_id = ctx.request.query.data_id;

  var res = {};

  var shop_data = await(getDB(shop)); 
  if (shop_data == null) {
    ctx.body = "No shop data";
    ctx.status = 400;
    return;
  }

  if (data_key == PROXY_KEY_SHOP) {
    var api_res = await(callRESTAPI(ctx, shop, 'countries', null, 'GET'));
    console.log(`${JSON.stringify(api_res)}`);
    res.tax = api_res.countries[0].tax;
    res.country = api_res.countries[0].code;
    res.locale = res.country === 'JP' ? 'ja-JP' : 'en-US';
    /* --  https://shopify.dev/concepts/graphql/pagination -- */
    api_res = await(callGraphql(ctx, shop, `{
      shop {
        currencyCode
        currencyFormats {
          moneyWithCurrencyFormat
        }
        taxesIncluded          
      }
    }`));
    console.log(`${JSON.stringify(api_res)}`);  
    res.currency = api_res.data.shop.currencyCode;
    res.tax_included = api_res.data.shop.taxesIncluded;
    res.symbol = res.currency === 'JPY' ? '¥' : '$';
  } else {
    if (typeof data_id === UNDEFINED || data_id == null) {
      ctx.status = 400;
      return;
    }
    if (data_key == PROXY_KEY_PRODUCTS) {
      api_res = await(callGraphql(ctx, shop, `{
        product(id: "gid://shopify/Product/${data_id}") {
          title
          handle
          totalVariants
          variants(first:1) {
            edges {
              node {
                id
                price
                taxable
              }
            }
          }    
        }
      }`));
      console.log(`${JSON.stringify(api_res)}`);  
      res.taxable = api_res.data.product.variants.edges[0].node.taxable;
      res.price = api_res.data.product.variants.edges[0].node.price;
    } else if (data_key == PROXY_KEY_VARIANTS) {
      api_res = await(callGraphql(ctx, shop, `{
        productVariant(id: "gid://shopify/ProductVariant/${data_id}") {
          price
          taxable
        }
      }`));
      console.log(`${JSON.stringify(api_res)}`);
      res.currency = api_res.data.shop.currencyCode;
      res.tax_included = api_res.data.shop.taxesIncluded;
    }
  }  
  ctx.body = res;
});

/* 
 * 
 * --- App proxy with storefront and liquid ---
 * 
*/
router.get('/proxy_storefront_liquid',  async (ctx, next) => {
  console.log("---------- /proxy_storefront_liquid ------------");
  if (!checkAppProxySignature(ctx.request.query)) {
    ctx.status = 400;
    return;
  }

  let shop = ctx.request.query.shop;

  let email = `${new Date().getTime()}@example.com`;
  let pass = `${new Date().getTime()}_pass`;

  // Create a customer by Storefront GraphQL mutation
  await(callGraphql(ctx, shop, `mutation customerCreate($input: CustomerCreateInput!) {
    customerCreate(input: $input) {
      customer {
        id
      }
      customerUserErrors {
        code
        field
        message
      }
    }
  }
  `, null, GRAPHQL_PATH_STOREFRONT, {
    "input": {
      "email": email,
      "password": pass
    }
  })); 

  let res = `<p>Shop Name (from Liquid object): {{shop.name}}</p><br/>
  {% form 'customer_login', id: 'myform' %} {{ form.errors | default_errors }}
    <input type="hidden" name="customer[email]" value="${email}" />
    <input type="hidden" name="customer[password]" value="${pass}" />
    <input type="submit" value="Sign In" />
  {% endform %} 
  <script>document.getElementById("myform").submit();</script>`;
  
  ctx.set('Content-Type','application/liquid');
  ctx.body = res;
});

/* 
 * 
 * --- SPA with Streofront API CDN hosted by File API upload ---
 * 
*/
router.get('/custom_storefront',  async (ctx, next) => {
  console.log("---------- /custom_storefront ------------");
  /*if (!checkAppProxySignature(ctx.request.query)) {
    ctx.status = 400;
    return;
  }*/

  const shop = ctx.request.query.shop;

  const shop_data = await(getDB(shop)); 
  if (shop_data == null) {
    ctx.body = "This shop hasn't installed the app.";
    return;
  }
  if (typeof shop_data.storefront_access_token === UNDEFINED) {
    ctx.body = "This shop doesn't have storefront access token.";
    return;
  }
  console.log(`${JSON.stringify(shop_data)}`);  

  let api_res = await(callGraphql(ctx, shop, `{
    node(id: "${shop_data.js_id}") {      
          ... on GenericFile {
            id
            url
          }         
      }
  }`));
  console.log(`${JSON.stringify(api_res)}`);
  
  await ctx.render('custom_storefront', {
    shop: shop,
    storefront_access_token: shop_data.storefront_access_token,
    storefront_js: api_res.data.node.url,
    version: API_VERSION
  });
});


/* 
 * 
 * --- Webhook  ---
 * 
*/
router.post('/webhook', async (ctx, next) => {
  console.log("******** webhook ********");
  console.log(JSON.stringify(ctx.request.body));
  /* Check the signature */
  let valid = await(checkWebhookSignature(ctx, "e5ba7f0a7fa4d480bbe44923feab9c5518ac95a24b0c406d10dcd1acb89dd407"));
  if (!valid) {
    ctx.status = 200;
    return;
  }  
  let webhook_body = ctx.request.body;    
  ctx.status = 200;
});

/* --- Check if the given signature is correct or not --- */
const checkSignature = function(json) {
  let temp = JSON.parse(JSON.stringify(json));
  console.log(`checkSignature ${JSON.stringify(temp)}`);
  if (typeof temp.hmac === UNDEFINED) return false;
  let sig = temp.hmac;
  delete temp.hmac; 
  let msg = Object.entries(temp).sort().map(e => e.join('=')).join('&');
  //console.log(`checkSignature ${msg}`);
  const hmac = crypto.createHmac('sha256', HMAC_SECRET);
  hmac.update(msg);
  let signarure =  hmac.digest('hex');
  console.log(`checkSignature ${signarure}`);
  return signarure === sig ? true : false;
};

const checkAppProxySignature = function(json) {
  let temp = JSON.parse(JSON.stringify(json));
  console.log(`checkAppProxySignature ${JSON.stringify(temp)}`);
  if (typeof temp.signature === UNDEFINED) return false;
  let sig = temp.signature;
  delete temp.signature; 
  let msg = Object.entries(temp).sort().map(e => e.join('=')).join('');
  //console.log(`checkAppProxySignature ${msg}`);
  const hmac = crypto.createHmac('sha256', HMAC_SECRET);
  hmac.update(msg);
  let signarure = hmac.digest('hex');
  console.log(`checkAppProxySignature ${signarure}`);
  return signarure === sig ? true : false;
};

/* --- Check if the given signarure is corect or not for Webhook --- */
const checkWebhookSignature = function(ctx, secret) {
  return new Promise(function (resolve, reject) {
    console.log(`checkWebhookSignature Headers ${ctx.headers}`);
    let receivedSig = ctx.headers["x-shopify-hmac-sha256"];
    console.log(`checkWebhookSignature Given ${receivedSig}`);
    if (receivedSig == null) return resolve(false);
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(Buffer.from(ctx.request.rawBody, 'utf8').toString('utf8'));
    let signarure = hmac.digest('base64');
    console.log(`checkWebhookSignature Created: ${signarure}`);
    return resolve(receivedSig === signarure ? true : false);    
  });  
};

/* --- --- */
const callGraphql = function(ctx, shop, ql, token = null, path = GRAPHQL_PATH_ADMIN, vars = null) {
  return new Promise(function (resolve, reject) {
    let api_req = {};
    // Set Gqphql string into query field of the JSON  as string
    api_req.query = ql.replace(/\n/g, '');
    if (vars != null) {
      api_req.variables = vars;
    }
    var access_token = token;
    var storefront = false;
    if (path == GRAPHQL_PATH_STOREFRONT) storefront = true;
    if (access_token == null) {
      getDB(shop).then(function(shop_data){
        if (shop_data == null) return resolve(null);
        access_token = shop_data.access_token;
        if (storefront) access_token = shop_data.storefront_access_token;
        accessEndpoint(ctx, `https://${shop}/${path}`, api_req, access_token, CONTENT_TYPE_JSON, 'POST', storefront).then(function(api_res){
          return resolve(api_res);
        }).catch(function(e){
          console.log(`callGraphql ${e}`);
          return reject(e);
        }); 
      }).catch(function(e){
        console.log(`callGraphql ${e}`);
        return reject(e);
      });     
    } else {
      accessEndpoint(ctx, `https://${shop}/${path}`, api_req, access_token, CONTENT_TYPE_JSON, 'POST', storefront).then(function(api_res){
        return resolve(api_res);
      }).catch(function(e){
        console.log(`callGraphql ${e}`);
        return reject(e);
      }); 
    }   
  });
};

/* --- --- */
const callRESTAPI = function(ctx, shop, sub_path, json, method = 'POST', token = null, path = RESTAPI_PATH_ADMIN) {
  return new Promise(function (resolve, reject) {
    var access_token = token;
    if (access_token == null) {
      getDB(shop).then(function(shop_data){
        if (shop_data == null) return resolve(null);
        access_token = shop_data.access_token;         
        accessEndpoint(ctx, `https://${shop}/${path}/${sub_path}.json`, json, access_token, CONTENT_TYPE_JSON, method).then(function(api_res){
          return resolve(api_res);
        }).catch(function(e){
          console.log(`callGraphql ${e}`);
          return reject(e);
        }); 
      }).catch(function(e){
        console.log(`callGraphql ${e}`);
        return reject(e);
      });     
    } else {
      accessEndpoint(ctx, `https://${shop}/${path}/${sub_path}.json`, json, access_token, CONTENT_TYPE_JSON, method).then(function(api_res){
        return resolve(api_res);
      }).catch(function(e){
        console.log(`callGraphql ${e}`);
        return reject(e);
      }); 
    }   
  });
};

/* ---  --- */
const accessEndpoint = function(ctx, endpoint, req, token = null, content_type = CONTENT_TYPE_JSON, method = 'POST', storefront = false) {
  var token_header = 'X-Shopify-Access-Token';
  if (storefront) token_header = 'X-Shopify-Storefront-Access-Token'; 
  console.log(`accessEndpoint　${endpoint} ${JSON.stringify(req)} ${token_header} ${token} ${content_type} ${method}`);
  return new Promise(function(resolve, reject) { 
    // Success callback
    var then_func = function(res){
      console.log(`accessEndpoint Success: ${res}`);
      return resolve(JSON.parse(res));
    };
    // Failure callback
    var catch_func = function(e){
      console.log(`accessEndpoint Error: ${e}`);
      return resolve(e);      
    };
    let headers = {};
    headers['Content-Type'] = content_type;
    if (token != null) {
      headers[token_header] = token;
    }
    if (method == 'GET') {
      ctx.get(endpoint, req, headers).then(then_func).catch(catch_func);
    } else if (method == 'PATCH') {
      ctx.patch(endpoint, req, headers).then(then_func).catch(catch_func);
    } else if (method == 'PUT') {
      ctx.put(endpoint, req, headers).then(then_func).catch(catch_func);
    } else if (method == 'DELETE') {
      ctx.delete(endpoint, req, headers).then(then_func).catch(catch_func);
    } else { // Default POST
      ctx.post(endpoint, req, headers).then(then_func).catch(catch_func);
    }    
  });
};    

/* ---  --- */
const insertDB = function(key, data) {
  return new Promise(function (resolve, reject) { mongo.MongoClient.connect(MONGO_URL).then(function(db){
    //console.log(`insertDB Connected: ${MONGO_URL}`);
    var dbo = db.db(MONGO_DB_NAME);    
    //console.log(`insertDB Used: ${MONGO_DB_NAME}`);
    console.log(`insertDB insertOne, _id:${key}`);
    dbo.collection(MONGO_COLLECTION).insertOne({"_id": key, "data": data}).then(function(res){
      db.close();
      return resolve(0);
    }).catch(function(e){
      console.log(`insertDB Error ${e}`);
    });
  }).catch(function(e){
    console.log(`insertDB Error ${e}`);
  });});
};

/* ---  --- */
const getDB = function(key) {
  return new Promise(function(resolve, reject) { mongo.MongoClient.connect(MONGO_URL).then(function(db){
    //console.log(`getDB Connected ${MONGO_URL}`);
    var dbo = db.db(MONGO_DB_NAME);    
    //console.log(`getDB Used ${MONGO_DB_NAME}`);
    console.log(`getDB findOne, _id:${key}`);
    dbo.collection(MONGO_COLLECTION).findOne({"_id": `${key}`}).then(function(res){
      db.close();
      if (res == null) return resolve(null);
      return resolve(res.data);
    }).catch(function(e){
      console.log(`getDB Error ${e}`);
    });
  }).catch(function(e){
    console.log(`getDB Error ${e}`);
  });});
};

/* ---  --- */
const setDB = function(key, data) {
  return new Promise(function(resolve, reject) { mongo.MongoClient.connect(MONGO_URL).then(function(db){
    //console.log(`setDB Connected ${MONGO_URL}`);
    var dbo = db.db(MONGO_DB_NAME);    
    //console.log(`setDB Used ${MONGO_DB_NAME}`);
    console.log(`setDB findOneAndUpdate, _id:${key}`);
    dbo.collection(MONGO_COLLECTION).findOneAndUpdate({"_id": `${key}`}, {$set: {"data": data}}, {new: true}).then(function(res){
      db.close();
      return resolve(res);
    }).catch(function(e){
      console.log(`setDB Error ${e}`);
    });
  }).catch(function(e){
    console.log(`setDB Error ${e}`);
  });});
};

/* ---  --- */
/*const searchDB = function(condition) {
  return new Promise(function(resolve, reject) { mongo.MongoClient.connect(MONGO_URL).then(function(db){
    //console.log(`searchDB Connected ${MONGO_URL}`);
    var dbo = db.db(MONGO_DB_NAME);    
    //console.log(`searchDB Used ${MONGO_DB_NAME}`);
    console.log(`searchDB find ${JSON.stringify(condition)}`);
    dbo.collection(MONGO_COLLECTION).find(condition).toArray().then(function(res){
      db.close();
      return resolve(res);
    }).catch(function(e){
      console.log(`searchDB Error ${e}`);
    });
  }).catch(function(e){
    console.log(`searchDB Error ${e}`);
  });});
};*/

app.use(router.routes());
app.use(router.allowedMethods());

if (!module.parent) app.listen(process.env.PORT || 3000);