<template>
  <div>
    <div class="field">
      <label>Street</label>
      <input v-model="addr.street" placeholder="123 Main St" />
    </div>
    <div class="form-row-2">
      <div class="field">
        <label>City</label>
        <input v-model="addr.city" placeholder="City" />
      </div>
      <div class="field">
        <label>{{ stateLabel }}</label>
        <select v-if="stateOptions.length" v-model="addr.state" class="select-input">
          <option value="">Select {{ stateLabel }}…</option>
          <option v-for="s in stateOptions" :key="s" :value="s">{{ s }}</option>
        </select>
        <input v-else v-model="addr.state" :placeholder="stateLabel" />
      </div>
    </div>
    <div class="form-row-2">
      <div class="field">
        <label>{{ zipLabel }}</label>
        <input v-model="addr.zip" :placeholder="zipLabel" />
      </div>
      <div class="field">
        <label>Country</label>
        <select v-model="addr.country" class="select-input">
          <option value="">Select country…</option>
          <optgroup label="Common">
            <option v-for="c in COMMON" :key="c" :value="c">{{ c }}</option>
          </optgroup>
          <optgroup label="All Countries">
            <option v-for="c in REST" :key="c" :value="c">{{ c }}</option>
          </optgroup>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Address } from '../api';

const addr = defineModel<Address>({ required: true });

// ── Country list ─────────────────────────────────────────────
const COMMON = [
  'United States', 'Canada', 'United Kingdom', 'Australia', 'New Zealand',
  'Ireland', 'Germany', 'France', 'Netherlands', 'Sweden', 'Norway', 'Denmark',
  'Finland', 'Switzerland', 'Belgium', 'Austria', 'Spain', 'Italy', 'Portugal',
  'Singapore', 'Japan', 'South Korea', 'India', 'South Africa',
  'United Arab Emirates', 'Israel', 'Brazil', 'Mexico',
];

const ALL = [
  'Afghanistan','Albania','Algeria','Andorra','Angola','Argentina','Armenia',
  'Austria','Azerbaijan','Bahamas','Bahrain','Bangladesh','Belarus','Belgium',
  'Belize','Benin','Bolivia','Bosnia and Herzegovina','Botswana','Brazil',
  'Brunei','Bulgaria','Burkina Faso','Cambodia','Cameroon','Canada','Chile',
  'China','Colombia','Congo','Costa Rica','Croatia','Cuba','Cyprus',
  'Czech Republic','Denmark','Dominican Republic','Ecuador','Egypt',
  'El Salvador','Estonia','Ethiopia','Finland','France','Georgia','Germany',
  'Ghana','Greece','Guatemala','Honduras','Hungary','Iceland','India',
  'Indonesia','Iran','Iraq','Ireland','Israel','Italy','Jamaica','Japan',
  'Jordan','Kazakhstan','Kenya','Kuwait','Kyrgyzstan','Latvia','Lebanon',
  'Libya','Lithuania','Luxembourg','Malaysia','Maldives','Malta','Mexico',
  'Moldova','Mongolia','Montenegro','Morocco','Mozambique','Myanmar','Namibia',
  'Nepal','Netherlands','New Zealand','Nicaragua','Nigeria','North Macedonia',
  'Norway','Oman','Pakistan','Panama','Paraguay','Peru','Philippines','Poland',
  'Portugal','Qatar','Romania','Russia','Rwanda','Saudi Arabia','Senegal',
  'Serbia','Singapore','Slovakia','Slovenia','Somalia','South Africa',
  'South Korea','Spain','Sri Lanka','Sudan','Sweden','Switzerland','Syria',
  'Taiwan','Tajikistan','Tanzania','Thailand','Tunisia','Turkey','Uganda',
  'Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay',
  'Uzbekistan','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe',
].sort();

const REST = computed(() => ALL.filter(c => !COMMON.includes(c)));

// ── State/province data ───────────────────────────────────────
const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
  'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
  'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
  'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada',
  'New Hampshire','New Jersey','New Mexico','New York','North Carolina',
  'North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island',
  'South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont',
  'Virginia','Washington','Washington D.C.','West Virginia','Wisconsin','Wyoming',
];

const CA_PROVINCES = [
  'Alberta','British Columbia','Manitoba','New Brunswick',
  'Newfoundland and Labrador','Northwest Territories','Nova Scotia',
  'Nunavut','Ontario','Prince Edward Island','Quebec','Saskatchewan','Yukon',
];

const AU_STATES = [
  'Australian Capital Territory','New South Wales','Northern Territory',
  'Queensland','South Australia','Tasmania','Victoria','Western Australia',
];

const UK_REGIONS = ['England','Scotland','Wales','Northern Ireland'];

const stateOptions = computed(() => {
  switch (addr.value.country) {
    case 'United States':   return US_STATES;
    case 'Canada':          return CA_PROVINCES;
    case 'Australia':       return AU_STATES;
    case 'United Kingdom':  return UK_REGIONS;
    default: return [];
  }
});

const stateLabel = computed(() => {
  switch (addr.value.country) {
    case 'United States':  return 'State';
    case 'Canada':         return 'Province';
    case 'Australia':      return 'State / Territory';
    case 'United Kingdom': return 'Region';
    default: return 'State / Province';
  }
});

const zipLabel = computed(() => {
  switch (addr.value.country) {
    case 'United States': return 'ZIP Code';
    case 'United Kingdom': return 'Postcode';
    default: return 'Postal Code';
  }
});
</script>

<style scoped>
.select-input {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border-2);
  border-radius: var(--r-btn);
  padding: 8px 11px;
  color: var(--text);
  font-size: 13px;
  font-family: var(--font);
  outline: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7094' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 30px;
  cursor: pointer;
  transition: border-color .12s;
}
.select-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(78,126,247,.15); }
.select-input option, .select-input optgroup { background: #1c1f2e; color: var(--text); }
</style>
