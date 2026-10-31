using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Vistoria.Api.Configurations;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Infrastructure.OpenApi;
using Vistoria.Api.Services;

namespace Vistoria.Api.Controllers.V1;

// Público: é aqui que o token nasce. O rate limit por IP é a proteção contra força bruta e cadastro em massa; o
// signout não tem limite nem 429, então o 429 é declarado em cada ação limitada, não na classe.
[ApiController]
[Route("api/v1/auth")]
[AllowAnonymous]
public class AuthController(IAuthService auth) : ControllerBase
{
    // Sem Location: a conta não tem rota própria de leitura.
    [HttpPost("signup")]
    [EndpointName("signUp")]
    [EnableRateLimiting(RateLimitConfig.SignUpPolicy)]
    [ProducesResponseType<AuthDto>(StatusCodes.Status201Created)]
    [ProblemResponses(StatusCodes.Status400BadRequest, StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<AuthDto>> SignUp(SignUpDto body, CancellationToken cancellationToken) =>
        StatusCode(StatusCodes.Status201Created, WithCookie(await auth.SignUpAsync(body, cancellationToken)));

    // 401 é sempre invalid-credentials: senha errada e e-mail inexistente respondem igual.
    [HttpPost("signin")]
    [EndpointName("signIn")]
    [EnableRateLimiting(RateLimitConfig.SignInPolicy)]
    [ProducesResponseType<AuthDto>(StatusCodes.Status200OK)]
    [ProblemResponses(
        StatusCodes.Status400BadRequest, StatusCodes.Status401Unauthorized, StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<AuthDto>> SignIn(SignInDto body, CancellationToken cancellationToken) =>
        Ok(WithCookie(await auth.SignInAsync(body, cancellationToken)));

    // O refresh token vem só do cookie. Na tolerância a resposta sai sem Set-Cookie: o navegador já tem o sucessor.
    [HttpPost("refresh")]
    [EndpointName("refreshToken")]
    [EnableRateLimiting(RateLimitConfig.RefreshPolicy)]
    [ProducesResponseType<AccessTokenDto>(StatusCodes.Status200OK)]
    [ProblemResponses(StatusCodes.Status401Unauthorized, StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<AccessTokenDto>> RefreshToken(CancellationToken cancellationToken)
    {
        var result = await auth.RefreshAsync(RefreshTokenCookie.Read(Request), cancellationToken);
        if (result.RefreshToken is { } successor)
        {
            RefreshTokenCookie.Append(Response, successor);
        }

        return Ok(result.Body);
    }

    // Sempre 204 e o cookie apagado, com ou sem sessão: sair duas vezes, ou sem cookie, não é erro.
    [HttpPost("signout")]
    [EndpointName("signOut")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> SignOut(CancellationToken cancellationToken)
    {
        await auth.SignOutAsync(RefreshTokenCookie.Read(Request), cancellationToken);
        RefreshTokenCookie.Delete(Response);
        return NoContent();
    }

    private AuthDto WithCookie(AuthSession session)
    {
        RefreshTokenCookie.Append(Response, session.RefreshToken);
        return session.Body;
    }
}
