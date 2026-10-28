import { selectOIDCClaims } from './oidc-claims';

describe('OIDC claims trust boundary', () => {
  const id = {
    iss: 'https://idp/',
    sub: 'subject',
    email: 'id@internal.example',
    email_verified: true,
  };
  it('never borrows verified from an ID token for a different UserInfo email', () => {
    expect(
      selectOIDCClaims(id, { sub: 'subject', email: 'info@internal.example' }),
    ).toMatchObject({ email: 'info@internal.example', emailVerified: false });
  });
  it('does not borrow verified from UserInfo that supplies no email', () => {
    expect(
      selectOIDCClaims(
        { ...id, email_verified: false },
        { sub: 'subject', email_verified: true },
      ),
    ).toMatchObject({ email: id.email, emailVerified: false });
  });
  it('rejects missing subjects and mismatched UserInfo', () => {
    expect(() => selectOIDCClaims({ ...id, sub: '' })).toThrow();
    expect(() => selectOIDCClaims(id, { sub: 'other' })).toThrow();
  });
});
