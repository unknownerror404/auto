(window.webpackJsonp=window.webpackJsonp||[]).push([[20],{77:function(e,t,o){"use strict";Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var a,r=n(o(3)),i=function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var o in e)if(Object.prototype.hasOwnProperty.call(e,o)){var a=Object.defineProperty&&Object.getOwnPropertyDescriptor?Object.getOwnPropertyDescriptor(e,o):{};a.get||a.set?Object.defineProperty(t,o,a):t[o]=e[o]}return t.default=e,t}(o(0));n(o(2)),n(o(101));function n(e){return e&&e.__esModule?e:{default:e}}function d(e,t,o,r){a||(a="function"==typeof Symbol&&Symbol.for&&Symbol.for("react.element")||60103);var i=e&&e.defaultProps,n=arguments.length-3;if(t||0===n||(t={children:void 0}),t&&i)for(var d in i)void 0===t[d]&&(t[d]=i[d]);else t||(t=i||{});if(1===n)t.children=r;else if(n>1){for(var l=new Array(n),s=0;s<n;s++)l[s]=arguments[s+3];t.children=l}return{$$typeof:a,type:e,key:void 0===o?null:""+o,ref:null,props:t,_owner:null}}function l(e,t,o){return t in e?Object.defineProperty(e,t,{value:o,enumerable:!0,configurable:!0,writable:!0}):e[t]=o,e}function s(){return(s=Object.assign||function(e){for(var t=1;t<arguments.length;t++){var o=arguments[t];for(var a in o)Object.prototype.hasOwnProperty.call(o,a)&&(e[a]=o[a])}return e}).apply(this,arguments)}function u(e,t){if(null==e)return{};var o,a,r=function(e,t){if(null==e)return{};var o,a,r={},i=Object.keys(e);for(a=0;a<i.length;a++)o=i[a],t.indexOf(o)>=0||(r[o]=e[o]);return r}(e,t);if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e);for(a=0;a<i.length;a++)o=i[a],t.indexOf(o)>=0||Object.prototype.propertyIsEnumerable.call(e,o)&&(r[o]=e[o])}return r}const c=e=>{let{to:t}=e,o=u(e,["to"]);return t.includes("http")?i.default.createElement("a",s({},e,{href:t})):("#"===t[0]&&(t=r.default.join("/auto/","pages/generated/init.html")+t),i.default.createElement("a",s({},o,{href:t,onClick:o=>{if(o.preventDefault(),"#"===e.to)return!1;const a=new URL(r.default.join(window.location.origin,t));window.history.pushState((e=>({href:e.href,pathname:e.pathname,hash:e.hash,query:e.query}))(a),null,t),e.onClick();const i=new CustomEvent("changeLocation",{detail:a});return dispatchEvent(i),!1}})))};c.defaultProps={href:"",onClick:()=>{}};const h=e=>{var t,o;return o=t=class extends i.default.Component{constructor(...e){super(...e),l(this,"state",{Comp:null})}componentDidMount(){!this.state.Comp&&this.props.shouldLoad&&e().then(e=>{this.setState({Comp:e.default})})}render(){const{Comp:e}=this.state;return e?i.default.createElement(e,this.props,this.props.children||null):null}},l(t,"defaultProps",{shouldLoad:!0}),o};h(()=>o.e(26).then(o.bind(null,102))),h(()=>o.e(26).then(o.bind(null,103)));var p=d("h1",{},void 0,"Initialization"),v=d("code",{},void 0,"auto"),f=d("code",{},void 0,"init"),m=d("p",{},void 0,"Interactive setup for most configurable options"),g=d("table",{},void 0,d("thead",{},void 0,d("tr",{},void 0,d("th",{},void 0,"Flag"),d("th",{},void 0,"Type"),d("th",{},void 0,"Description"))),d("tbody",{},void 0,d("tr",{},void 0,d("td",{},void 0,d("code",{},void 0,"--only-labels")),d("td",{},void 0,"Boolean"),d("td",{},void 0,"Only run init for the labels. As most other options are for advanced users")),d("tr",{},void 0,d("td",{},void 0,d("code",{},void 0,"--dry-run"),", ",d("code",{},void 0,"-d")),d("td",{},void 0,"Boolean"),d("td",{},void 0,"Report what command will do but do not actually do anything")))),b=d("pre",{},void 0,d("code",{className:"language-sh"},void 0,"auto init",d("br",{}))),y=d("code",{},void 0,"create-labels"),w=d("p",{},void 0,"Create your project's labels on github. If labels exist it will update them."),O=d("table",{},void 0,d("thead",{},void 0,d("tr",{},void 0,d("th",{},void 0,"Flag"),d("th",{},void 0,"Type"),d("th",{},void 0,"Description"))),d("tbody",{},void 0,d("tr",{},void 0,d("td",{},void 0,d("code",{},void 0,"--dry-run"),", ",d("code",{},void 0,"-d")),d("td",{},void 0,"Boolean"),d("td",{},void 0,"Report what command will do but do not actually do anything")))),P=d("pre",{},void 0,d("code",{className:"language-sh"},void 0,"auto create-labels",d("br",{}))),j=d("article",{className:"message column is-warning"},void 0,d("div",{className:"message-body"},void 0,d("p",{},void 0,"⚠️ For this to work you must have a ",d("code",{},void 0,"GH_TOKEN")," set, ex: ",d("code",{},void 0,"GH_TOKEN=YOUR_TOKEN auto create-labels"))));var k=e=>d("div",{className:e.className},void 0,d("section",{},void 0,p,d("p",{},void 0,v," provides some tools to quickly set up your project. If you do not want to use the interactive experience all these options can be configured via the ",d(c,{currentPage:e.currentPage,to:"/auto/pages/generated/autorc.html"},void 0,".autorc")," and most can be configure via CLI options."),d("h3",{id:"init"},void 0,f," ",d(c,{currentPage:e.currentPage,className:"fas fa-hashtag headerLink",to:"#init","aria-hidden":"true"})),m,d("h4",{id:"options"},void 0,"Options ",d(c,{currentPage:e.currentPage,className:"fas fa-hashtag headerLink",to:"#options","aria-hidden":"true"})),g,d("h4",{id:"examples"},void 0,"Examples ",d(c,{currentPage:e.currentPage,className:"fas fa-hashtag headerLink",to:"#examples","aria-hidden":"true"})),b,d("h3",{id:"create-labels"},void 0,y," ",d(c,{currentPage:e.currentPage,className:"fas fa-hashtag headerLink",to:"#create-labels","aria-hidden":"true"})),w,d("h4",{id:"options-2"},void 0,"Options ",d(c,{currentPage:e.currentPage,className:"fas fa-hashtag headerLink",to:"#options-2","aria-hidden":"true"})),O,d("h4",{id:"examples-2"},void 0,"Examples ",d(c,{currentPage:e.currentPage,className:"fas fa-hashtag headerLink",to:"#examples-2","aria-hidden":"true"})),P,j));t.default=k,e.exports=t.default}}]);
//# sourceMappingURL=init.js.map