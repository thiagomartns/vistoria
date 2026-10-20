using System.Security.Claims;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Vistoria.Api.Model;

namespace Vistoria.Api.Infrastructure.Auth;

public sealed record AccessToken(string Token, DateTimeOffset ExpiresAt);

/// <summary>
/// JWT HS256 com <c>iat</c>, <c>nbf</c> e <c>exp</c> do <see cref="TimeProvider"/>, nunca do relógio da máquina
/// (o <c>TokenGenerator</c> do curso usava <c>DateTime.Now</c>).
/// </summary>
public sealed class AccessTokenGenerator(IOptions<JwtOptions> options, TimeProvider time)
{
    /// <summary>Prazo do access token (backend.md, "Parâmetros compartilhados").</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);

    private static readonly JsonWebTokenHandler Handler = new() { SetDefaultTimesOnTokenCreation = false };

    public AccessToken Create(User user)
    {
        var jwt = options.Value;
        // O JWT guarda segundos inteiros: o expiresAt do corpo nunca passa do exp do token.
        var now = DateTimeOffset.FromUnixTimeSeconds(time.GetUtcNow().ToUnixTimeSeconds());
        var expiresAt = now + Lifetime;

        var token = Handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = jwt.Issuer,
            Audience = jwt.Audience,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = expiresAt.UtcDateTime,
            Subject = new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.CreateVersion7(now).ToString()),
            ]),
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(jwt.SigningKeyBytes()), SecurityAlgorithms.HmacSha256),
        });

        return new AccessToken(token, expiresAt);
    }
}
