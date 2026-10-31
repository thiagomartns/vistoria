using System.Buffers.Text;
using System.Security.Cryptography;
using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Net.Http.Headers;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Tests.Support;

/// <summary>
/// O cookie <c>refresh_token</c> nos testes. Ele é Secure e o TestServer fala http, então o CookieContainer não o
/// devolveria: o cliente não guarda cookie e cada chamada manda o seu à mão, o que deixa explícito qual cookie vai.
/// </summary>
public static class RefreshCookies
{
    /// <summary><c>POST</c> sem corpo, com o <c>refresh_token</c> no cabeçalho <c>Cookie</c> quando não é nulo.</summary>
    public static HttpRequestMessage Post(string path, string? cookie)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path);
        if (cookie is not null)
        {
            request.Headers.Add(HeaderNames.Cookie, $"refresh_token={cookie}");
        }

        return request;
    }

    /// <summary>O único <c>Set-Cookie</c> do <c>refresh_token</c> na resposta.</summary>
    public static SetCookieHeaderValue FromResponse(HttpResponseMessage response) =>
        SetCookieHeaderValue.ParseList(response.Headers.GetValues(HeaderNames.SetCookie).ToList())
            .Should().ContainSingle(c => c.Name == "refresh_token").Subject;

    /// <summary>A linha do token, achada pelo SHA-256 do valor do cookie, como a API acha.</summary>
    public static async Task<RefreshToken?> StoredToken(ApiFactory factory, string cookie)
    {
        var hash = SHA256.HashData(Base64Url.DecodeFromChars(cookie));
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.RefreshTokens.AsNoTracking()
            .SingleOrDefaultAsync(t => t.TokenHash == hash, TestContext.Current.CancellationToken);
    }

    /// <summary>Todas as linhas da família do token.</summary>
    public static async Task<List<RefreshToken>> FamilyRows(ApiFactory factory, string cookie)
    {
        var familyId = (await StoredToken(factory, cookie))!.FamilyId;
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.RefreshTokens.AsNoTracking().Where(t => t.FamilyId == familyId)
            .ToListAsync(TestContext.Current.CancellationToken);
    }
}
