import { describe, expect, it } from 'vitest';
import { parseMapsLink } from './maps';

describe('parseMapsLink', () => {
  it('lee enlaces largos de Google Maps', () => {
    expect(parseMapsLink('https://www.google.com/maps/place/Metrocentro/@13.7055,-89.2122,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d13.7051!4d-89.2108')).toEqual({ ok: true, lat: 13.7051, lng: -89.2108 });
    expect(parseMapsLink('https://www.google.com/maps/@13.6989,-89.1914,15z')).toEqual({ ok: true, lat: 13.6989, lng: -89.1914 });
    expect(parseMapsLink('https://maps.google.com/?q=13.4833,-88.1833')).toEqual({ ok: true, lat: 13.4833, lng: -88.1833 });
    expect(parseMapsLink('13.6769, -89.2797')).toEqual({ ok: true, lat: 13.6769, lng: -89.2797 });
  });
  it('explica los enlaces cortos y el texto inválido', () => {
    const short = parseMapsLink('https://maps.app.goo.gl/AbCdEf123');
    expect(short.ok).toBe(false);
    expect(parseMapsLink('hola').ok).toBe(false);
  });
});
