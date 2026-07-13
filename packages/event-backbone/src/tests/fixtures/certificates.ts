/**
 * Synthetic X.509 fixtures. **Generated, self-signed, and worthless.**
 *
 * These are nobody's real certificate. They were produced with `openssl req -x509` for this
 * suite alone, they chain to nothing, and their private keys were thrown away.
 *
 * **Supabase's real CA certificate is not here, and must never be** — not because it is secret
 * (a CA certificate is public trust material) but because it is *deployment configuration*. A
 * provider rotating its CA must not require a commit to this repository (ADR-0024 §3).
 *
 * They are TypeScript string constants rather than `.pem` files on purpose. A repository that
 * contains no certificate **file** cannot accidentally ship one — and a secrets sweep that
 * flags every `.pem` stays useful, instead of becoming noise everybody learns to ignore.
 */

/** A self-signed root. `basicConstraints=critical,CA:TRUE`, so `X509Certificate.ca === true`. */
export const SYNTHETIC_CA_PEM = [
  '-----BEGIN CERTIFICATE-----',
  'MIIDMTCCAhmgAwIBAgIUJ9cLatTARkdFQCjPOyzGZUTOIUUwDQYJKoZIhvcNAQEL',
  'BQAwKDEmMCQGA1UEAwwdUUYgSmFydmlzIFN5bnRoZXRpYyBUZXN0IENBIDEwHhcN',
  'MjYwNzEyMTMyMzM4WhcNMzYwNzA5MTMyMzM4WjAoMSYwJAYDVQQDDB1RRiBKYXJ2',
  'aXMgU3ludGhldGljIFRlc3QgQ0EgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC',
  'AQoCggEBALm4GDo3Sa9D8tH+NJrBoYTgSQDhSDoZ54ToMDZN9YjBrwETt3HCI+Br',
  'MR9GhfHXQNdeuoNAsgPoYI8w/SqNapIwMnTSRt+m+3GqHOvRomH3Av6W/ikgAoMu',
  '5DBkhEZg0fRScLzs9jpYorgK7t5BHf7O6QhufLb9hE4OR8MjnmLX3iWM/MHUey35',
  'S6X2vPdyKK/tOmuMXOTlfxCkoG2/r8Hsnm/cSsdMVtu7wrVOQrYieyGu9OdU9EuH',
  'nXddrGwv2Qe6tdaV+juUCrQouJ5lAh3YzMRo2JGGgweovochI/nIB7dJzY9HcsXE',
  'AjR2L/aINyQZIDl5Ox3rK1ISh7WGbMkCAwEAAaNTMFEwHQYDVR0OBBYEFMdJTdWr',
  'GQz19uI+1sMhvJIbKYBwMB8GA1UdIwQYMBaAFMdJTdWrGQz19uI+1sMhvJIbKYBw',
  'MA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAK8Snt0sZ5RKFz8X',
  'p+tLO5szWETi1gPCiZgIUunefYQWLGzk7oDiFSn1vKhsc85Vy03OihMRj7qdU6oT',
  'ysydLXLXKZaz3hvLsVK+fv9BqXt4liqLpKxSJ7tXFQjp/b1Q7HdsHyzLWMDJnzS1',
  '+3BXU5SEgssS2SlU9M4x28doEV3lgwa61w7nhUvHrGxutZhOi/9dnM5G9mODWqzX',
  'X25zHRH6kU0OpzrjRrFspT/rrz1cK551nC470oU8YN98/y8n9T8bl+APwoNajdjm',
  'M0I+UZjvf2HtaLNO6F2iDbinWe/FhOcJ8DKVHLyDBEler91FtIYyots4+rcjHlPe',
  'eCGJzJ0=',
  '-----END CERTIFICATE-----',
].join('\n');

/** A second, unrelated root. Proves a multi-certificate bundle is accepted. */
export const SYNTHETIC_CA_2_PEM = [
  '-----BEGIN CERTIFICATE-----',
  'MIIDMTCCAhmgAwIBAgIUV9lt7YyAzLnopVYO93wR0QMe46IwDQYJKoZIhvcNAQEL',
  'BQAwKDEmMCQGA1UEAwwdUUYgSmFydmlzIFN5bnRoZXRpYyBUZXN0IENBIDIwHhcN',
  'MjYwNzEyMTMyMzM4WhcNMzYwNzA5MTMyMzM4WjAoMSYwJAYDVQQDDB1RRiBKYXJ2',
  'aXMgU3ludGhldGljIFRlc3QgQ0EgMjCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC',
  'AQoCggEBAKmO9+cB4HwW1q3WaZ3bZjSvlgjtyuH84wD3NxiarGMioB/8U7b40SqG',
  'dIih1zAc4fbl5B2kwjMsLH418LsZb4nUlSRR/qIlsTE64IJDsYUoN+2Q4+IDWMnH',
  'rGkdQBwAJWKRPDSJ4E4wqAuxYoBARs/6TJhHGtbCZFffwvS+xtNVw1Npu4gIUdXn',
  'ECbvdwPSKDiFUXhFM1tjpa0Pu9VPMdz1ponaZ7VdPhshcznQQMFJvq/jlpGoLHxx',
  'V18qzge0svEy/s8Qo1+Ww4bE+f2CuHw+tZz62DNTxsZPHVQwn97iW5JcRdRcnvyH',
  'fkD8p+OG7FkXVjOglR26dPAOidvJkr0CAwEAAaNTMFEwHQYDVR0OBBYEFD3/rqtg',
  '2kI8ft0EwuWcd9JjyHj8MB8GA1UdIwQYMBaAFD3/rqtg2kI8ft0EwuWcd9JjyHj8',
  'MA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBABv00jR03B0qU34/',
  'yyZCenD736XmN/T8n3vJRHS+c0qeZmizHgG9ERx51X8qC/jo6sz8c85HdMqsICwV',
  'BmHC7WXNYXaNwm0+Ps3Y745Xh3z9uRtZ6krswU0zWxgE5iABRrE2BeuVUuh6SE8x',
  '2HYFV1zB5IF9lsFciST03lVJzQxD8IDr2HogNKgQ7KzvlsX21/s4ngQFzd9+b+Pq',
  '6KNVIS/GLu1t6DxG8j7ruV9xUlgMVMOicFyARNMCTZrQaDKiHVlcqzbetnGKeEA3',
  '/nhx/RLva2xtxs5UG1kfQ7ISfvA6/D0A/8jB/EAdzDb9UeT8iFksBjHJe8WNogyH',
  'IGW/t3s=',
  '-----END CERTIFICATE-----',
].join('\n');

/**
 * A **leaf** certificate — `CA:FALSE`, so `X509Certificate.ca === false`.
 *
 * It parses perfectly. It is a real, valid certificate. And it is **useless as a trust anchor**,
 * which is precisely why shape-checking was not enough: a bundle containing only this would have
 * sailed straight through a regex, and then failed at handshake time, in production, with an
 * error message about something else.
 */
export const SYNTHETIC_LEAF_PEM = [
  '-----BEGIN CERTIFICATE-----',
  'MIIDJTCCAg2gAwIBAgIUP4BwGpVkZBbIQrmpiqA2soLW1X0wDQYJKoZIhvcNAQEL',
  'BQAwKDEmMCQGA1UEAwwdUUYgSmFydmlzIFN5bnRoZXRpYyBUZXN0IENBIDEwHhcN',
  'MjYwNzEyMTMyMzM4WhcNMzYwNzA5MTMyMzM4WjAfMR0wGwYDVQQDDBRsZWFmLmV4',
  'YW1wbGUuaW52YWxpZDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAO0d',
  '8MozrBDUyiqvShalvb7hhODiLlEXXFlnGJDnx50WghwMEo/OZmtLgH/t1cdBrPyI',
  '8JQi4nO2uoZNGuVSaS6C/NpBCUVcQIoNXWQhjor0tUXY1J58rckoasskOvD0ggEl',
  'Xdj0ybRs/aZIz4iaL24eONnhvojHeIs+iBakJ6l1utgb7xJ/qE7KH9vbJo0AJm0x',
  'bcKmwMACd//7D8RX/KX3AVhiHKSenUuh88+3Vmi7B1SHgepfq+E6m7fKUTQuslRj',
  '3X1WOK/eWB00PdfW9/iHcumZQRTQGlaIcwPFLEqjGKC9efsKvL2szdYVq5jWzZFK',
  'HTK3tOmD12bokttknkcCAwEAAaNQME4wDAYDVR0TAQH/BAIwADAdBgNVHQ4EFgQU',
  'V8mEvAOAbGp8htU5qn1YUi81z2wwHwYDVR0jBBgwFoAUx0lN1asZDPX24j7WwyG8',
  'khspgHAwDQYJKoZIhvcNAQELBQADggEBALiRXrZynTBpnReGSjfW203a/PvTYvJ3',
  'NdpjMo7E2oJfZ5A/xs4UWunabkp9eUTPDfeRKyVfQzhHNejq2DxKyrUqnNYMPSme',
  '+I6XrBTnmplebaXld8wgRQ4Mzkq7NFRZIySPFUS72I9Zh80HseFPthQdD3uK0i9e',
  'XXHsK6+vNQGHZ/XIrcTTApj7pPf5Z14bZmiBFM4VWdjL8kIifFZzCpmEE/aqThR1',
  '1gNhAzy8qTxOJ+7FLTH8Lfp5h6NP3cd7LlgMr9fvl0op2hPU384I3xom2Se+TSuM',
  'vm6bGWlEyncvfkNYEouRQts/zeeq47DURKsK2lHTd2Oa5E5B0GATzVc=',
  '-----END CERTIFICATE-----',
].join('\n');

/** Two roots in one file — the ordinary shape of a provider's CA bundle. */
export const SYNTHETIC_CA_BUNDLE_PEM = SYNTHETIC_CA_PEM + '\n' + SYNTHETIC_CA_2_PEM;

/** Certificate-**shaped**, but the base64 is noise. Passes a regex; parses as nothing. */
export const SYNTHETIC_GARBAGE_PEM = [
  '-----BEGIN CERTIFICATE-----',
  'VGhpcyBpcyBub3QgYSBjZXJ0aWZpY2F0ZS4gSXQgaXMganVzdCBzb21lIGJhc2U2',
  'NCB0aGF0IGhhcHBlbnMgdG8gc2l0IGJldHdlZW4gdHdvIFBFTSBoZWFkZXJzLg==',
  '-----END CERTIFICATE-----',
].join('\n');

/** A real CA with its DER cut in half. Well-formed PEM envelope; unparseable contents. */
export const SYNTHETIC_TRUNCATED_PEM = (() => {
  const lines = SYNTHETIC_CA_PEM.split('\n');
  const body = lines.slice(1, -1);
  const half = body.slice(0, Math.max(1, Math.floor(body.length / 2)));
  return ['-----BEGIN CERTIFICATE-----', ...half, '-----END CERTIFICATE-----'].join('\n');
})();

/** A private key. It must never be accepted where a CA belongs, and it gets its own error. */
export const SYNTHETIC_PRIVATE_KEY_PEM = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDHdV3RbGdxSGVy',
  'ZSBpcyBzb21lIGJhc2U2NCB0aGF0IGxvb2tzIGxpa2UgYSBrZXkgYnV0IGlzIG5v',
  '-----END PRIVATE KEY-----',
].join('\n');
