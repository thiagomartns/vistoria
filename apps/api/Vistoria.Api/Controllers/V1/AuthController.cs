using Microsoft.AspNetCore.Mvc;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.OpenApi;
using Vistoria.Api.Services;

namespace Vistoria.Api.Controllers.V1;

[ApiController]
[Route("api/v1/auth")]
public class AuthController(IAuthService auth) : ControllerBase
{
    // Sem Location: a conta não tem rota própria de leitura.
    [HttpPost("signup")]
    [EndpointName("signUp")]
    [ProducesResponseType<AuthDto>(StatusCodes.Status201Created)]
    [ProblemResponses(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<AuthDto>> SignUp(SignUpDto body, CancellationToken cancellationToken) =>
        StatusCode(StatusCodes.Status201Created, await auth.SignUpAsync(body, cancellationToken));
}
