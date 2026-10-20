using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Vistoria.Api.Data.DTO.V1;

namespace Vistoria.Api.Controllers.V1;

// Público: o proxy e o front checam se a API está de pé sem token.
[ApiController]
[AllowAnonymous]
[Route("api/v1/health")]
public class HealthController : ControllerBase
{
    [HttpGet]
    [EndpointName("getHealth")]
    [ProducesResponseType<HealthDto>(StatusCodes.Status200OK)]
    public ActionResult<HealthDto> Get() => Ok(new HealthDto("ok"));
}
