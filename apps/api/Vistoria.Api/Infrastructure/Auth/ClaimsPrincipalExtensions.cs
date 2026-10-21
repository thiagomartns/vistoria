using System.Security.Claims;
using Microsoft.IdentityModel.JsonWebTokens;
using Vistoria.Api.Infrastructure.Errors;

namespace Vistoria.Api.Infrastructure.Auth;

public static class ClaimsPrincipalExtensions
{
    /// <summary>
    /// Id do usuário do access token (<c>sub</c>, sem o mapeamento de claims do .NET). É o <c>OwnerId</c> de tudo o
    /// que ele grava. Sem <c>sub</c> válido → <see cref="UnauthorizedException"/>.
    /// </summary>
    public static Guid GetUserId(this ClaimsPrincipal user) =>
        Guid.TryParse(user.FindFirst(JwtRegisteredClaimNames.Sub)?.Value, out var id)
            ? id
            : throw new UnauthorizedException();
}
