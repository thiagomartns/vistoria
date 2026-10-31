using System.Buffers.Text;
using System.Security.Cryptography;

namespace Vistoria.Api.Infrastructure.Auth;

/// <summary>Um refresh token recém-emitido: o valor vai para o cookie e nunca para o banco.</summary>
public sealed record IssuedRefreshToken(string Value, DateTimeOffset ExpiresAt);

/// <summary>Prazos e formato do refresh token (backend.md, "Autenticação" e "Parâmetros compartilhados").</summary>
public static class RefreshTokens
{
    /// <summary>Prazo de cada token, renovado a cada uso.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(7);

    /// <summary>Teto absoluto da família, desde o login: depois dele, só <c>signin</c>.</summary>
    public static readonly TimeSpan FamilyLifetime = TimeSpan.FromDays(30);

    /// <summary>Por quanto tempo um token já substituído ainda devolve um access token (abas em corrida).</summary>
    public static readonly TimeSpan RotationGrace = TimeSpan.FromSeconds(30);

    private const int ByteLength = 32;

    /// <summary>32 bytes aleatórios em base64url, e o SHA-256 deles, que é o que o banco guarda.</summary>
    public static (string Value, byte[] Hash) Create()
    {
        var bytes = RandomNumberGenerator.GetBytes(ByteLength);
        return (Base64Url.EncodeToString(bytes), SHA256.HashData(bytes));
    }

    /// <summary>
    /// SHA-256 do token do cookie. Ausente ou fora do formato de <see cref="Create"/> → <c>null</c>: nenhum token
    /// emitido teria esse valor.
    /// </summary>
    public static byte[]? TryHash(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length != Base64Url.GetEncodedLength(ByteLength))
        {
            return null;
        }

        Span<byte> bytes = stackalloc byte[ByteLength];
        return Base64Url.TryDecodeFromChars(value, bytes, out var written) && written == ByteLength
            ? SHA256.HashData(bytes)
            : null;
    }
}

/// <summary>
/// O cookie do refresh token: <c>HttpOnly</c> (o JavaScript nunca lê), <c>Secure</c>, <c>SameSite=Strict</c> e só
/// para as rotas de <c>/api/v1/auth</c>, que são as únicas que o usam.
/// </summary>
public static class RefreshTokenCookie
{
    public const string Name = "refresh_token";
    public const string Path = "/api/v1/auth";

    public static string? Read(HttpRequest request) => request.Cookies[Name];

    public static void Append(HttpResponse response, IssuedRefreshToken token) =>
        response.Cookies.Append(Name, token.Value, Options(token.ExpiresAt));

    /// <summary>
    /// Apaga o cookie no navegador: valor vazio, mesmo <c>Path</c> e <c>Max-Age=0</c>. O <c>Cookies.Delete</c> do
    /// ASP.NET só manda <c>Expires</c> em 1970, sem o <c>Max-Age</c>.
    /// </summary>
    public static void Delete(HttpResponse response)
    {
        var options = Options(DateTimeOffset.UnixEpoch);
        options.MaxAge = TimeSpan.Zero;
        response.Cookies.Append(Name, "", options);
    }

    private static CookieOptions Options(DateTimeOffset expires) => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Strict,
        Path = Path,
        Expires = expires,
    };
}
