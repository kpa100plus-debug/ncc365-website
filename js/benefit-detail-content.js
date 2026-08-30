import { benefitMap } from "./benefit-catalog.js";

const $ = selector => document.querySelector(selector);
export const offerId = new URLSearchParams(location.search).get("id") || "first-health";
export const offer = benefitMap[offerId] || benefitMap["first-health"];

document.title = `${offer.title} | 전국소비자클럽`;
$("#crumbTitle").textContent = offer.title;
$("#detailStatus").textContent = offer.status;
$("#detailCategory").textContent = offer.category;
$("#detailTitle").textContent = offer.title;
$("#detailLead").textContent = offer.lead;
$("#detailTarget").textContent = offer.target;
$("#detailArea").textContent = offer.area;
$("#detailPeriod").textContent = offer.condition;
$("#detailVisual").innerHTML = `<img src="${offer.image}" alt="${offer.title}" loading="eager">`;
$("#pointGrid").innerHTML = offer.points.map((value, index) => `<div><span>0${index + 1}</span><b>${value}</b></div>`).join("");
$("#stepList").innerHTML = offer.steps.map(value => `<li>${value}</li>`).join("");
$("#appType").innerHTML = offer.types.map(value => `<option>${value}</option>`).join("");
$("#formTitle").textContent = `${offer.title} 신청`;
